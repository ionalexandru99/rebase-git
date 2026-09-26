import type { BranchNotMerged } from "@rebase/contracts";

const listedCommits = 3;

export function UnmergedCommits({
  failure,
}: {
  readonly failure: BranchNotMerged;
}) {
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
