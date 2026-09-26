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
      if (checkout === undefined || checkout === command.worktreePath)
        return yield* fastForwardBranch(
          git,
          command.worktreePath,
          command.branch,
          checkout !== undefined,
        );
      return yield* coordination
        .run(
          checkout,
          {
            name: "pull",
            locks: { worktree: "wait" },
            duringOperation: "block",
          },
          fastForwardBranch(git, checkout, command.branch, true),
        )
        .pipe(
          Effect.catchTag("RepositoryCoordinationError", (error) =>
            Effect.fail(pullBlocked(error.detail)),
          ),
        );
    });
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
