import { ErrorNotification } from "#web/features/notifications/index";
import { useRepositoryPullError } from "#web-ui/features/repository-pull/repository-pull-provider";

export function PullNotice() {
  const error = useRepositoryPullError();
  return error === undefined ? null : (
    <ErrorNotification key={error.id} message={error.message} />
  );
}
