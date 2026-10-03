import { Effect } from "effect";
import {
  type PullBranch,
  RepositoryPullApi,
} from "#contracts/repository-pull/repository-pull.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
  route,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import {
  pullBlocked,
  pullBranch,
} from "#server/features/repository-pull/pull-branch.ts";
import {
  createPullStrategies,
  type PullStrategies,
} from "#server/features/repository-pull/pull-strategy.ts";
import { acquireRepositoryFetch } from "#server/features/repository-pull/repository-fetch.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function repositoryPullFeature(
  dependencies: RepositoryDependencies & {
    readonly context: EnvironmentContext;
    readonly events: EnvironmentEventPublisher;
  },
) {
  return Effect.gen(function* () {
    const { command } = repositoryRoutes(dependencies);
    const { events } = dependencies;
    const fetch = yield* acquireRepositoryFetch(dependencies);
    const strategies = createPullStrategies(
      dependencies.context,
      dependencies.access,
    );
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
          pullInCheckout(dependencies.coordination, strategies),
        ),
        route(RepositoryPullApi.readPullStrategy, () => strategies.server),
        route(RepositoryPullApi.savePullStrategy, ({ strategy }) =>
          strategies.saveServer(strategy).pipe(
            Effect.tap(() => Effect.sync(() => events.publishChanged())),
            Effect.as(strategy),
          ),
        ),
        route(
          RepositoryPullApi.readRepositoryPullStrategy,
          ({ repositoryId }) => strategies.repository(repositoryId),
        ),
        route(
          RepositoryPullApi.saveRepositoryPullStrategy,
          ({ repositoryId, strategy }) =>
            strategies.saveRepository(repositoryId, strategy).pipe(
              Effect.tap((repositoryIds) =>
                Effect.sync(() => events.publishChanged(repositoryIds)),
              ),
              Effect.andThen(strategies.repository(repositoryId)),
            ),
        ),
      ],
    } satisfies EnvironmentFeature;
  });
}

function pullInCheckout(
  coordination: RepositoryCoordination,
  strategies: PullStrategies,
) {
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
            pullBranch(
              git,
              coordination,
              {
                directory,
                branch: command.branch,
                checkedOut: checkout !== undefined,
                strategy: command.strategy,
              },
              strategies
                .effective(command.repositoryId)
                .pipe(
                  Effect.catchTag("EnvironmentStorageError", (error) =>
                    Effect.fail(pullBlocked(error.message)),
                  ),
                ),
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
      () => pullBlocked("The branch was checked out while pulling."),
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
