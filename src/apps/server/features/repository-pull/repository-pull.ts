import type { PullBranch } from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryCoordinationService } from "#server/domain/repository-coordination.contract";
import { fastForwardBranch } from "#server/features/repository-pull/git/fast-forward-branch";
import { pullBlocked } from "#server/features/repository-pull/git/pull-failures";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/access/index";

export function pullBranch(coordination: RepositoryCoordinationService) {
  return (command: PullBranch, git: GitCommandRunner) =>
    Effect.gen(function* () {
      const checkout = yield* findCheckout(git, command);
      const directory = checkout ?? command.worktreePath;
      return yield* coordination.run(
        directory,
        {
          name: "pull",
          locks: { worktree: "wait" },
          duringOperation: "block",
        },
        requireSameCheckout(git, command, checkout).pipe(
          Effect.andThen(
            fastForwardBranch(
              git,
              directory,
              command.branch,
              checkout !== undefined,
            ),
          ),
        ),
      );
    });
}

function requireSameCheckout(
  git: GitCommandRunner,
  command: PullBranch,
  checkout: string | undefined,
) {
  return findCheckout(git, command).pipe(
    Effect.filterOrFail(
      (current) => current === checkout,
      () => pullBlocked(`${command.branch} was checked out while pulling`),
    ),
  );
}

function findCheckout(git: GitCommandRunner, command: PullBranch) {
  return readWorktrees(git, command.worktreePath).pipe(
    Effect.flatMap(canonicalizeWorktrees),
    Effect.map(
      (worktrees) =>
        worktrees.find((worktree) => worktree.head.branch === command.branch)
          ?.path,
    ),
  );
}
