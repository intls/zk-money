import React from 'react';
import styled from 'styled-components';
import { Form, isValidForm, MessageType } from '../../app';
import {
  Button,
  DisclaimerBlock,
  InfoItem,
  InfoTable,
  InputMessage,
  InputTheme,
  PaddedBlock,
  Text,
  TextLink,
  TxProgress,
} from '../../components';
import checkIcon from '../../images/check.svg';
import warningIcon from '../../images/exclamation_mark.svg';
import { colours, gradients, spacings, Theme } from '../../styles';

const Footer = styled.div`
  display: flex;
  justify-content: center;
  padding: ${spacings.s} 0;
`;

const ConfirmRoot = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

const EditButton = styled(TextLink)`
  opacity: 0.5;
`;

const FooterMessage = styled(InputMessage)`
  text-align: center;
`;

const FeedbackRoot = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
`;

interface FeedbackIconProps {
  type: 'warning' | 'success';
}

const FeedbackIconRoot = styled.div<FeedbackIconProps>`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 96px;
  height: 96px;
  border-radius: 100%;
  user-select: none;
  background: ${({ type }) =>
    type === 'warning'
      ? colours.yellow
      : `linear-gradient(134.14deg, ${gradients.primary.from} 18.37%, ${gradients.primary.to} 82.04%)`};
`;

const FeedbackIcon = styled.img`
  height: 40px;
`;

const FeedbackMessage = styled(Text)`
  padding: ${spacings.xs} 0;
  text-align: center;
`;

const FeedbackTitle = styled(FeedbackMessage)`
  padding: ${spacings.s} 0;
`;

const FeedbackButtonRoot = styled.div`
  padding: ${spacings.xs} 0;
`;

const RetryButtonsRoot = styled(FeedbackButtonRoot)`
  display: flex;
  justify-content: center;
  width: 100%;

  ${EditButton} {
    position: absolute;
    left: 0;
  }
`;

interface ProgressStep {
  status: number;
  text: string;
}

interface ProgressTemplateProps {
  theme: Theme;
  action: string;
  items: InfoItem[];
  steps: ProgressStep[];
  form: Form;
  currentStatus: number;
  confirmStatus: number;
  doneStatus: number;
  message?: string;
  messageType?: MessageType;
  onGoBack(): void;
  onSubmit(): void;
  onClose(): void;
}

export const ProgressTemplate: React.FunctionComponent<ProgressTemplateProps> = ({
  theme,
  action,
  items,
  steps,
  form,
  currentStatus,
  confirmStatus,
  doneStatus,
  message,
  messageType,
  onGoBack,
  onSubmit,
  onClose,
}) => {
  const inputTheme = theme === Theme.WHITE ? InputTheme.WHITE : InputTheme.LIGHT;

  const failed = messageType === MessageType.ERROR && !!message;
  const success = currentStatus === doneStatus;
  const expired = currentStatus === confirmStatus && !isValidForm(form!);

  const createProgress = (text: string, status: number) => (
    <TxProgress
      key={status}
      text={text}
      done={status < currentStatus}
      isLoading={status === currentStatus && !failed}
      failed={status === currentStatus && failed}
      inactive={status > currentStatus}
    />
  );

  const renderFooterContent = () => {
    if (expired) {
      return (
        <FeedbackRoot>
          <FeedbackIconRoot type="warning">
            <FeedbackIcon src={warningIcon} />
          </FeedbackIconRoot>
          <FeedbackTitle text="Session Expired" size="xl" />
          <FeedbackMessage
            text="One or more values have changed. Please go back to previous step to adjust your inputs."
            size="s"
          />
          <FeedbackButtonRoot>
            <TextLink text="(Edit Transaction)" size="s" onClick={onGoBack} />
          </FeedbackButtonRoot>
        </FeedbackRoot>
      );
    }
    if (currentStatus === confirmStatus) {
      return (
        <ConfirmRoot>
          <EditButton text="(Edit Transaction)" size="xs" onClick={onGoBack} />
          <Button theme="gradient" text={`Confirm ${action}`} onClick={onSubmit} />
        </ConfirmRoot>
      );
    }
    if (success) {
      return (
        <FeedbackRoot>
          <FeedbackIconRoot type="success">
            <FeedbackIcon src={checkIcon} />
          </FeedbackIconRoot>
          <FeedbackTitle text="Transaction Sent!" size="xl" />
          <TextLink text="(Close Window)" size="xs" onClick={onClose} />
        </FeedbackRoot>
      );
    }
    if (message && messageType === MessageType.ERROR) {
      return (
        <FeedbackRoot>
          <FooterMessage theme={inputTheme} message={message} type={messageType} />
          <RetryButtonsRoot>
            <EditButton text="(Edit Transaction)" size="xs" onClick={onGoBack} />
            <TextLink text="(Retry)" size="s" onClick={onSubmit} />
          </RetryButtonsRoot>
        </FeedbackRoot>
      );
    }
    if (message) {
      return <FooterMessage theme={inputTheme} message={message} type={messageType} />;
    }
    return <FooterMessage theme={inputTheme} message="Do not close this window before the transaction has sent." />;
  };

  return (
    <>
      <PaddedBlock size="m">
        <InfoTable theme={inputTheme} items={items} />
      </PaddedBlock>
      {!success && !expired && (
        <PaddedBlock size="s">
          {currentStatus === confirmStatus ? (
            <DisclaimerBlock />
          ) : (
            steps.map(({ text, status }) => createProgress(text, status))
          )}
        </PaddedBlock>
      )}
      <Footer>{renderFooterContent()}</Footer>
    </>
  );
};
