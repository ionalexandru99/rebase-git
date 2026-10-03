import type { UnmergedBranch } from "#contracts/repository-refs/repository-branches.contract.ts";
import {
  Confirmation,
  ConfirmationList,
} from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { branchLabel, deletionTitle } from "#web/features/refs/ref-deletion.ts";
import type { RefEditing } from "#web/features/refs/ref-editing.ts";

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
        key={pending.unmerged === undefined ? "confirm" : "unmerged"}
        onCancel={editing.deletion.cancel}
        onConfirm={editing.deletion.confirm}
        title={deletionTitle(pending.deletion)}
      >
        {pending.unmerged === undefined ? undefined : (
          <UnmergedBranches unmerged={pending.unmerged} />
        )}
      </Confirmation>
    </PersistentNotification>
  );
}

function UnmergedBranches({
  unmerged,
}: {
  readonly unmerged: readonly UnmergedBranch[];
}) {
  const [only] = unmerged;
  if (unmerged.length === 1 && only !== undefined)
    return <UnmergedCommits branch={only} />;
  return (
    <>
      <p className="text-muted-foreground">
        These branches have commits that exist nowhere else.
      </p>
      <ConfirmationList
        items={unmerged.map(({ branch }) => branchLabel(branch))}
      />
    </>
  );
}

function UnmergedCommits({ branch }: { readonly branch: UnmergedBranch }) {
  const hidden = branch.count - Math.min(branch.count, listedCommits);
  return (
    <>
      <p className="text-muted-foreground">
        {branch.count === 1
          ? "1 commit exists only on this branch."
          : `${branch.count} commits exist only on this branch.`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {branch.commits.slice(0, listedCommits).map((commit) => (
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
