import { type PullBranch, RepositoryPullApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import {
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import {
  fastForwardBranch,
  pullBlocked,
} from "#server/features/repository-pull/fast-forward-branch";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

export function repositoryPullFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { command } = repositoryRoutes(dependencies);
  return {
    routes: [
      command(
        RepositoryPullApi.pull,
        {
          name: "pull",
          locks: { refs: "wait" },
          duringOperation: "proceed",
        },
        pullBranch(dependencies.coordination),
      ),
    ],
  };
}

function pullBranch(coordination: RepositoryCoordination) {
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
