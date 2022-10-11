import { BridgeCallData } from '@aztec/sdk';
import { useRollupProviderStatus } from '../../../alt-model/index.js';
import { useDefaultEnterBridgeCallData } from '../../../alt-model/defi/defi_info_hooks.js';
import { DefiRecipe } from '../../../alt-model/defi/types.js';
import { estimateDefiSettlementTimes } from '../../../alt-model/estimate_settlement_times.js';

export function useCountDownData(bridgeCallData?: BridgeCallData) {
  const rpStatus = useRollupProviderStatus();
  if (!rpStatus) return;
  const bridgeCallDataNum = bridgeCallData?.toBigInt();
  const status = rpStatus.bridgeStatus.find(x => x.bridgeCallData === bridgeCallDataNum);
  const totalSlots = status?.numTxs ?? rpStatus.runtimeConfig.defaultDeFiBatchSize;
  const fraction = status ? Number(status.gasAccrued) / Number(status.gasThreshold) : 0;
  const takenSlots = Math.floor(totalSlots * Math.min(1, Math.max(0, fraction)));
  const { batchSettlementTime } = estimateDefiSettlementTimes(rpStatus, status);
  return { totalSlots, takenSlots, nextBatch: batchSettlementTime };
}

export function useDefaultEnterCountDownData(recipe: DefiRecipe) {
  const bridgeCallData = useDefaultEnterBridgeCallData(recipe);
  return useCountDownData(bridgeCallData);
}