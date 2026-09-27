import { Confirmation } from "#web/components/ui/confirmation";
import type { TagEditing } from "#web/features/branches-sidebar/tag-editing/hooks/use-tag-editing";
import { ErrorNotification } from "#web/features/notifications/components/error-notification";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification";

export function TagEditingStatus({
  editing: { deletion },
}: {
  readonly editing: TagEditing;
}) {
  return (
    <>
      {deletion.pending === undefined ? null : (
        <PersistentNotification>
          <Confirmation
            action="Delete"
            busy={deletion.pending.busy}
            className="px-3 py-2"
            onCancel={deletion.cancel}
            onConfirm={deletion.confirm}
            title={`Delete tag ${deletion.pending.name}?`}
          />
        </PersistentNotification>
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
