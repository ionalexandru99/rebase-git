import { type PullBranch, RepositoryPullApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  route,
} from "#server/adapters/environment-transport/environment-routes";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import {
  fastForwardBranch,
  pullBlocked,
} from "#server/features/repository-pull/fast-forward-branch";
import { acquireRepositoryFetch } from "#server/features/repository-pull/repository-fetch";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access";
import type { RepositoryCoordination } from "#server/repository/repository-coordination";

export function repositoryPullFeature(
  dependencies: RepositoryDependencies & {
    readonly events: EnvironmentEventPublisher;
  },
) {
  return Effect.gen(function* () {
    const { command } = repositoryRoutes(dependencies);
    const fetch = yield* acquireRepositoryFetch(dependencies);
    return {
      routes: [
        route(RepositoryPullApi.fetchStatus, (input) =>
          fetch.status(input.repositoryId),
        ),
        route(RepositoryPullApi.fetch, (input) =>
          fetch.fetch(input.repositoryId),
        ),
        route(RepositoryPullApi.configureFetch, (input) =>
          fetch.configure(input.repositoryId, input.setting),
        ),
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
    } satisfies EnvironmentFeature;
  });
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
