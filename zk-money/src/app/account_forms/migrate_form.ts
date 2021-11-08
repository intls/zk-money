import { AccountId, TxType, WalletSdk } from '@aztec/sdk';
import createDebug from 'debug';
import { EventEmitter } from 'events';
import { AccountState } from '../account_state';
import { AccountUtils } from '../account_utils';
import { AppAssetId, assets } from '../assets';
import { Database } from '../database';
import {
  BoolInput,
  clearMessage,
  FormStatus,
  FormValue,
  isValidForm,
  mergeValues,
  withError,
  withWarning,
} from '../form';
import { KeyVault } from '../key_vault';
import { Provider, ProviderEvent } from '../provider';
import { AccountForm, AccountFormEvent } from './account_form';

const debug = createDebug('zm:migrate_form');

export interface MigratingAsset {
  assetId: AppAssetId;
  fee: bigint;
  totalFee: bigint;
  values: bigint[];
  migratableValues: bigint[];
  migratedValues: bigint[];
}

export const getMigratableValues = (values: bigint[], fee: bigint) => {
  const migratableValues = [];
  for (let i = 0; i < values.length; i += 2) {
    const noteValues = values.slice(i, i + 2);
    const amount = noteValues.reduce((sum, value) => sum + value, 0n);
    if (amount > fee) {
      migratableValues.push(...noteValues);
    }
  }
  return migratableValues;
};

export enum MigrateStatus {
  CONNECT,
  SYNC,
  CONFIRM,
  VALIDATE,
  MIGRATE,
  DONE,
}

interface MigratingAssetInput extends FormValue {
  value: MigratingAsset[];
}

export interface MigrateFormValues {
  migratingAssets: MigratingAssetInput;
  status: {
    value: MigrateStatus;
  };
  submit: BoolInput;
}

const initialMigrateFormValues = {
  migratingAssets: {
    value: assets.map(({ id }) => ({
      assetId: id,
      fee: 0n,
      totalFee: 0n,
      values: [],
      migratableValues: [],
      migratedValues: [],
    })),
  },
  status: {
    value: MigrateStatus.CONNECT,
  },
  submit: {
    value: false,
  },
};

export class MigrateForm extends EventEmitter implements AccountForm {
  private readonly userId: AccountId;

  private values: MigrateFormValues = initialMigrateFormValues;
  private formStatus = FormStatus.ACTIVE;
  private destroyed = false;

  private keyVault?: KeyVault;

  constructor(
    accountState: AccountState,
    private provider: Provider | undefined,
    private readonly sdk: WalletSdk,
    private readonly db: Database,
    private readonly accountUtils: AccountUtils,
  ) {
    super();
    this.userId = accountState.userId;
  }

  get locked() {
    return this.formStatus === FormStatus.LOCKED || this.formStatus === FormStatus.PROCESSING;
  }

  get processing() {
    return this.formStatus === FormStatus.PROCESSING;
  }

  private get status() {
    return this.values.status.value;
  }

  getValues() {
    return { ...this.values };
  }

  destroy() {
    if (this.processing) {
      throw new Error('Cannot destroy a form while it is being processed.');
    }

    this.destroyed = true;
    this.removeAllListeners();
    this.provider?.off(ProviderEvent.UPDATED_PROVIDER_STATE, this.onProviderStateChange);
  }

  async init() {
    this.provider?.on(ProviderEvent.UPDATED_PROVIDER_STATE, this.onProviderStateChange);
    this.onProviderStateChange();
  }

  changeAssetState() {}

  changeProvider(provider?: Provider) {
    if (this.status !== MigrateStatus.CONNECT) {
      return;
    }

    this.provider?.off(ProviderEvent.UPDATED_PROVIDER_STATE, this.onProviderStateChange);
    this.provider = provider;
    this.provider?.on(ProviderEvent.UPDATED_PROVIDER_STATE, this.onProviderStateChange);
    this.onProviderStateChange();
  }

  changeEthAccount() {}

  changeValues(changes: Partial<MigrateFormValues>) {
    if (this.locked) {
      debug('Cannot change form values while it is locked.');
      return;
    }

    this.updateFormValues(changes);
  }

  unlock() {
    this.updateFormStatus(FormStatus.ACTIVE);
  }

  async lock() {
    this.updateFormStatus(FormStatus.LOCKED);
  }

  async submit() {
    if (this.processing) {
      debug('Duplicated call to MigrateForm.submit().');
      return;
    }

    this.updateFormStatus(FormStatus.PROCESSING);

    this.updateFormValues({ status: { value: MigrateStatus.VALIDATE }, submit: clearMessage({ value: true }) });

    const validated = await this.validateValues();
    if (!isValidForm(validated)) {
      this.updateFormValues(
        mergeValues(validated, { status: { value: MigrateStatus.CONFIRM }, submit: clearMessage({ value: false }) }),
      );
      this.updateFormStatus(FormStatus.LOCKED);
      return;
    }

    try {
      await this.migrateNotes();
    } catch (e) {
      debug(e);
      this.updateFormValues({
        submit: withError({ value: false }, `Something went wrong. This shouldn't happen.`),
      });
    }
    this.updateFormStatus(FormStatus.LOCKED);
  }

  private async validateValues() {
    const form = { ...this.values };

    const migratingAssets = form.migratingAssets.value;
    for (const asset of migratingAssets) {
      const fee = await this.sdk.getFee(asset.assetId, TxType.TRANSFER);
      if (fee > asset.fee) {
        form.migratingAssets = withError(form.migratingAssets, 'Insufficient fee.');
        break;
      }
    }

    return form;
  }

  private async syncBalance() {
    this.updateFormStatus(FormStatus.PROCESSING);
    this.updateFormValues({ status: { value: MigrateStatus.SYNC } });

    const { accountPublicKey, accountPrivateKey } = this.keyVault!;
    const prevUserId = new AccountId(accountPublicKey, this.userId.nonce - 1);
    await this.accountUtils.addUser(accountPrivateKey, prevUserId.nonce);
    await this.sdk.awaitUserSynchronised(prevUserId);

    const migratingAssets = await Promise.all(
      this.values.migratingAssets.value.map(async asset => {
        const notes = (await this.sdk.getSpendableNotes(asset.assetId, prevUserId)).sort((a, b) =>
          a.value < b.value ? 1 : -1,
        );
        const fee = await this.sdk.getFee(asset.assetId, TxType.TRANSFER);
        const values = notes.map(n => n.value);
        const migratableValues = getMigratableValues(values, fee);
        return {
          assetId: asset.assetId,
          fee,
          totalFee: fee * BigInt(Math.ceil(migratableValues.length / 2)),
          values,
          migratableValues,
          migratedValues: [],
        };
      }),
    );

    if (!migratingAssets.some(a => a.migratableValues.length)) {
      // Nothing to migrate.
      await this.accountUtils.removeUser(prevUserId);
    }

    this.updateFormStatus(FormStatus.LOCKED);
    this.updateFormValues({ migratingAssets: { value: migratingAssets }, status: { value: MigrateStatus.CONFIRM } });
  }

  private async migrateNotes() {
    this.updateFormValues({ status: { value: MigrateStatus.MIGRATE } });

    const updateMigratingAssets = (assetId: AppAssetId, value: bigint) => {
      const migratingAssets = this.values.migratingAssets.value.map(asset => {
        if (asset.assetId !== assetId) {
          return asset;
        }

        const { migratedValues } = asset;
        return {
          ...asset,
          migratedValues: [...migratedValues, value],
        };
      });
      this.updateFormValues({ migratingAssets: { value: migratingAssets } });
    };

    const migratingAssets = this.values.migratingAssets.value;
    const { accountPublicKey, accountPrivateKey } = this.keyVault!;
    const prevUserId = new AccountId(accountPublicKey, this.userId.nonce - 1);
    const signer = this.sdk.createSchnorrSigner(accountPrivateKey);
    for (const asset of migratingAssets) {
      const { assetId, fee, migratableValues } = asset;
      for (let i = 0; i < migratableValues.length; i += 2) {
        if (this.destroyed) {
          return;
        }

        const amount = migratableValues.slice(i, i + 2).reduce((sum, value) => sum + value, 0n) - fee;
        // Create private send proof.
        const proof = await this.sdk.createTransferProof(assetId, prevUserId, amount, fee, signer, this.userId);
        await this.sdk.sendProof(proof);
        await this.db.addMigratingTx({
          ...proof.tx,
          userId: this.userId,
        });

        updateMigratingAssets(assetId, amount);
      }
    }

    await this.accountUtils.removeUser(prevUserId);

    this.updateFormValues({ status: { value: MigrateStatus.DONE } });
  }

  private onProviderStateChange = async () => {
    if (this.status !== MigrateStatus.CONNECT) {
      return;
    }

    this.updateFormValues({
      submit: clearMessage({ value: false }),
    });

    if (!this.provider) {
      return;
    }

    const signingMessage = KeyVault.signingMessageV0(this.provider.account!, this.sdk).toString('hex');
    this.prompt(
      `To check the balances in your old account, please sign the following hash in your wallet: 0x${signingMessage.slice(
        0,
        6,
      )}...${signingMessage.slice(-4)}`,
    );

    try {
      this.keyVault = await KeyVault.createV0(this.provider, this.sdk);
      if (!this.destroyed && this.status === MigrateStatus.CONNECT) {
        this.provider.off(ProviderEvent.UPDATED_PROVIDER_STATE, this.onProviderStateChange);
        await this.syncBalance();
      }
    } catch (e) {
      if (this.status === MigrateStatus.CONNECT) {
        this.updateFormValues({ submit: withError({ value: false }, 'Message signature denied.') });
      }
    }
  };

  private updateFormStatus(status: FormStatus) {
    this.formStatus = status;
    this.emit(AccountFormEvent.UPDATED_FORM_STATUS, status);
  }

  private updateFormValues(changes: Partial<MigrateFormValues>) {
    this.values = mergeValues(this.values, changes);
    this.emit(AccountFormEvent.UPDATED_FORM_VALUES, this.values);
  }

  private prompt(message: string) {
    this.updateFormValues({
      submit: withWarning({ value: true }, message),
    });
  }
}