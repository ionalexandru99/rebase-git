import { ErrorNotification } from "#web/features/notifications/index";
import type { Pull } from "#web/features/repository-pull/hooks/use-pull";

export function PullNotice({ pull }: { readonly pull: Pull }) {
  const error = pull.error;
  return error === undefined ? null : (
    <ErrorNotification key={error.id} message={error.message} />
  );
}
