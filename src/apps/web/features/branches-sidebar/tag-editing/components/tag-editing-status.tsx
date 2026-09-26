import { DeleteRefConfirmation } from "#web/features/branches-sidebar/components/delete-ref-confirmation";
import type { TagEditing } from "#web/features/branches-sidebar/tag-editing/hooks/use-tag-editing";
import { ErrorNotification } from "#web/features/notifications/components/error-notification";

export function TagEditingStatus({
  editing: { deletion },
}: {
  readonly editing: TagEditing;
}) {
  return (
    <>
      {deletion.pending === undefined ? null : (
        <DeleteRefConfirmation
          busy={deletion.pending.busy}
          onCancel={deletion.cancel}
          onConfirm={deletion.confirm}
          title={`Delete tag ${deletion.pending.name}`}
        />
      )}
      {deletion.failure === undefined ? null : (
        <ErrorNotification
          key={deletion.failure.id}
          message={deletion.failure.message}
        />
      )}
    </>
  );
}
