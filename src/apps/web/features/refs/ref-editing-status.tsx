import { ConfirmNotice } from "#web/features/notifications/components/persistent-notification.tsx";
import { deletionTitle } from "#web/features/refs/ref-deletion.ts";
import type { RefEditing } from "#web/features/refs/ref-editing.ts";

export function RefEditingStatus({
  editing,
}: {
  readonly editing: RefEditing;
}) {
  const { pending } = editing.deletion;
  if (pending === undefined) return null;
  return (
    <ConfirmNotice
      notice={pending.deletion.kind === "tag" ? "deleteTag" : "deleteBranch"}
      action="Delete"
      busy={pending.busy ? "Deleting" : undefined}
      key={pending.earlier === undefined ? "ask" : "unmerged"}
      onCancel={editing.deletion.cancel}
      onConfirm={editing.deletion.confirm}
      title={deletionTitle(pending.deletion)}
    >
      {pending.unmerged === undefined ||
      pending.unmerged.length === 0 ? null : (
        <p>
          {pending.deletion.kind === "branch" &&
          pending.deletion.branches.length === 1
            ? "Its commits exist nowhere else."
            : "Some of their commits exist nowhere else."}
        </p>
      )}
    </ConfirmNotice>
  );
}
