import { PushButton } from "#web-ui/features/repository-push/components/push-button";
import { PushNotice } from "#web-ui/features/repository-push/components/push-notice";
import { RepositoryPushProvider } from "#web-ui/features/repository-push/repository-push-provider";

export const RepositoryPush = {
  Provider: RepositoryPushProvider,
  Button: PushButton,
  Notice: PushNotice,
};
