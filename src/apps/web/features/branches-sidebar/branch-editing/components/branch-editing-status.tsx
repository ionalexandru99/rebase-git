import type { RemoteBranch } from "@rebase/contracts";
import type { BranchDeletion } from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import { DeletedBranchNotification } from "#web/features/branches-sidebar/branch-editing/components/deleted-branch-notification";
import { UnmergedCommits } from "#web/features/branches-sidebar/branch-editing/components/unmerged-commits";
import { UpstreamPicker } from "#web/features/branches-sidebar/branch-editing/components/upstream-picker";
import type { BranchEditing } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-editing";
import { rowElementId } from "#web/features/branches-sidebar/components/branches-sidebar-rows";
import { DeleteRefConfirmation } from "#web/features/branches-sidebar/components/delete-ref-confirmation";

export function BranchEditingStatus({
  editing,
  remoteBranches,
}: {
  readonly editing: BranchEditing;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  const { deletion, edit, error } = editing;
  return (
    <>
      {error === undefined ? null : (
        <p
          className="mx-3 mb-3 rounded-md border border-status-unavailable/40 bg-status-unavailable/10 px-3 py-2 text-xs text-foreground"
          role="alert"
        >
          {error}
        </p>
      )}
      {edit?.kind !== "upstream" ? null : (
        <UpstreamPicker
          anchor={() => document.getElementById(rowElementId(edit.rowId))}
          branch={edit.branch}
          onChoose={(upstream) => void editing.setUpstream(upstream)}
          onClose={editing.cancel}
          remoteBranches={remoteBranches}
        />
      )}
      {deletion.pending === undefined ? null : (
        <DeleteRefConfirmation
          busy={deletion.pending.busy === true}
          key={deletion.pending.failure === undefined ? "confirm" : "unmerged"}
          onCancel={deletion.cancel}
          onConfirm={deletion.confirm}
          title={branchDeletionTitle(deletion.pending.deletion)}
        >
          {deletion.pending.failure === undefined ? null : (
            <UnmergedCommits failure={deletion.pending.failure} />
          )}
        </DeleteRefConfirmation>
      )}
      {deletion.deleted === undefined ? null : (
        <DeletedBranchNotification
          name={deletion.deleted.name}
          onDismiss={deletion.dismiss}
          onUndo={() => void deletion.undo()}
        />
      )}
    </>
  );
}

function branchDeletionTitle({ local, remote }: BranchDeletion) {
  if (remote === undefined) return `Delete ${local?.name ?? ""}`;
  if (local === undefined) return `Delete ${remote.name} on ${remote.remote}`;
  return `Delete ${local.name} locally and on ${remote.remote}`;
}
