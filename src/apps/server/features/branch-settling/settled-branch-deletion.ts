import { Effect } from "effect";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  branchRef,
  worktreeHolding,
} from "#server/features/repository-refs/git/branches/branch-git.ts";
import {
  deleteBranches,
  readRefTargets,
  unmergedBranches,
} from "#server/features/repository-refs/git/branches/delete-branches.ts";
import { removeWorktree } from "#server/features/repository-worktrees/repository-worktrees.ts";
import type { HostedPullRequest } from "#server/features/source-control/git-host.ts";
import type { RepositoryAccess } from "#server/repository/repository-access.ts";

const dayMilliseconds = 86_400_000;

export function settledLongEnough(
  settled: string,
  today: string,
  days: number,
) {
  return (
    days > 0 &&
    (Date.parse(today) - Date.parse(settled)) / dayMilliseconds >= days
  );
}

export function deleteSettledBranches(
  git: GitCommandRunner,
  access: RepositoryAccess,
  directory: string,
  names: readonly string[],
  pullRequests: ReadonlyMap<string, readonly HostedPullRequest[]>,
) {
  return Effect.gen(function* () {
    const refs = yield* readRefTargets(git, directory);
    const settled = names.flatMap((name) => {
      const target = refs.get(branchRef(name));
      return target === undefined ? [] : [{ local: { name, target } }];
    });
    if (settled.length === 0) return 0;
    const unmerged = new Set(
      (yield* unmergedBranches(git, directory, settled, refs)).map(
        ({ branch }) => branch.local?.name,
      ),
    );
    const worktrees = yield* access.worktrees(directory);
    const deletable = yield* Effect.filter(settled, ({ local }) => {
      if (
        unmerged.has(local.name) &&
        !mergedAtTip(pullRequests.get(local.name), local.target)
      )
        return Effect.succeed(false);
      const holder = worktreeHolding(worktrees, local.name);
      if (holder === undefined) return Effect.succeed(true);
      return removeWorktree(git, {
        worktreePath: directory,
        target: holder.path,
        changes: 0,
      }).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    });
    if (deletable.length === 0) return 0;
    yield* deleteBranches(git, access, {
      branches: deletable,
      force: true,
      worktreePath: directory,
    });
    return deletable.length;
  });
}

function mergedAtTip(
  pullRequests: readonly HostedPullRequest[] | undefined,
  target: string,
) {
  return (pullRequests ?? []).some(
    ({ headCommit, state }) =>
      state === "Merged" &&
      headCommit !== undefined &&
      headCommit.length >= 7 &&
      target.startsWith(headCommit),
  );
}
