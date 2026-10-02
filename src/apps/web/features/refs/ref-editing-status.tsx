import type { BranchNotMerged } from "#contracts/repository-refs/repository-branches.contract.ts";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  deletionTitle,
  type RefEditing,
} from "#web/features/refs/ref-editing.ts";

const listedCommits = 3;

export function RefEditingStatus({
  editing,
}: {
  readonly editing: RefEditing;
}) {
  const { pending } = editing.deletion;
  if (pending === undefined) return null;
  return (
    <PersistentNotification>
      <Confirmation
        action="Delete"
        busy={pending.busy}
        className="px-3 py-2"
        key={pending.failure === undefined ? "confirm" : "unmerged"}
        onCancel={editing.deletion.cancel}
        onConfirm={editing.deletion.confirm}
        title={deletionTitle(pending.deletion)}
      >
        {pending.failure === undefined ? undefined : (
          <UnmergedCommits failure={pending.failure} />
        )}
      </Confirmation>
    </PersistentNotification>
  );
}

function UnmergedCommits({ failure }: { readonly failure: BranchNotMerged }) {
  const hidden = failure.count - Math.min(failure.count, listedCommits);
  return (
    <>
      <p className="text-muted-foreground">
        {failure.count === 1
          ? "1 commit exists only on this branch."
          : `${failure.count} commits exist only on this branch.`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {failure.commits.slice(0, listedCommits).map((commit) => (
          <li className="flex min-w-0 gap-2" key={commit.oid}>
            <span className="shrink-0 font-mono text-muted-foreground">
              {commit.oid.slice(0, 7)}
            </span>
            <span className="truncate">{commit.subject}</span>
          </li>
        ))}
      </ul>
      {hidden === 0 ? null : (
        <p className="mt-0.5 text-muted-foreground">and {hidden} more</p>
      )}
    </>
  );
}
