import {
  type PullBranch,
  PullStrategyApi,
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
import { gitConfigSettingRoutes } from "#server/features/git-config-settings/git-config-setting.ts";
import type { GitLfs } from "#server/features/repository-lfs/git-lfs.ts";
import { fetchPruneSetting } from "#server/features/repository-pull/fetch-prune.ts";
import {
  pullBlocked,
  pullBranch,
} from "#server/features/repository-pull/pull-branch.ts";
import {
  createPullStrategies,
  type PullStrategies,
} from "#server/features/repository-pull/pull-strategy.ts";
import {
  type AfterFetch,
  acquireRepositoryFetch,
} from "#server/features/repository-pull/repository-fetch.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import {
  canonicalizeWorktrees,
  readWorktrees,
} from "#server/repository/repository-access.ts";
import type { RepositoryCoordination } from "#server/repository/repository-coordination.ts";

export function acquireRepositoryPullFeature(
  dependencies: RepositoryDependencies & {
    readonly afterFetch: AfterFetch;
    readonly context: EnvironmentContext;
    readonly events: EnvironmentEventPublisher;
  },
) {
  const { command } = repositoryRoutes(dependencies);
  const { events } = dependencies;
  const fetch = acquireRepositoryFetch(dependencies);
  const strategies = createPullStrategies(
    dependencies.context,
    dependencies.access,
  );
  const feature: EnvironmentFeature = {
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
      ...gitConfigSettingRoutes(fetchPruneSetting, dependencies),
      command(
        RepositoryPullApi.pull,
        {
          name: "pull",
          locks: { refs: "wait" },
          duringOperation: "proceed",
        },
        pullInCheckout(dependencies.coordination, dependencies.lfs, strategies),
      ),
      route(PullStrategyApi.read, () => strategies.server()),
      route(PullStrategyApi.save, async ({ value }) => {
        await strategies.saveServer(value);
        events.publishChanged();
        return value;
      }),
      route(PullStrategyApi.readRepository, ({ repositoryId }) =>
        strategies.repository(repositoryId),
      ),
      route(PullStrategyApi.saveRepository, async ({ repositoryId, value }) => {
        const repositoryIds = await strategies.saveRepository(
          repositoryId,
          value,
        );
        events.publishChanged(repositoryIds);
        return strategies.repository(repositoryId);
      }),
    ],
  };
  return { feature, close: fetch.close };
}

function pullInCheckout(
  coordination: RepositoryCoordination,
  lfs: GitLfs,
  strategies: PullStrategies,
) {
  return async (command: PullBranch, git: GitCommandRunner) => {
    const checkout = await findCheckout(git, command);
    const directory = checkout ?? command.worktreePath;
    return coordination.run(
      directory,
      {
        name: "pull",
        locks: { worktree: "wait" },
        duringOperation: "block",
      },
      async () => {
        if ((await findCheckout(git, command)) !== checkout)
          throw pullBlocked("The branch was checked out while pulling.");
        return pullBranch(
          git,
          coordination,
          lfs,
          {
            directory,
            branch: command.branch,
            checkedOut: checkout !== undefined,
            strategy: command.strategy,
          },
          async () => {
            try {
              return await strategies.effective(command.repositoryId);
            } catch (error) {
              throw error instanceof Error ? pullBlocked(error.message) : error;
            }
          },
        );
      },
    );
  };
}

async function findCheckout(git: GitCommandRunner, command: PullBranch) {
  const worktrees = await canonicalizeWorktrees(
    await readWorktrees(git, command.worktreePath),
  );
  return worktrees.find((worktree) => worktree.head.branch === command.branch)
    ?.path;
}
