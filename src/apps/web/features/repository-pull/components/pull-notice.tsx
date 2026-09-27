import { ErrorNotification } from "#web/features/notifications/components/error-notification";
import type { Pull } from "#web/features/repository-pull/use-pull";

export function PullNotice({ pull }: { readonly pull: Pull }) {
  return pull.error === undefined ? null : (
    <ErrorNotification message={pull.error} />
  );
}
