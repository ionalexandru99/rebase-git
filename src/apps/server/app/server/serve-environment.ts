import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import { combineEnvironmentFeatures } from "#server/adapters/environment-transport/environment-routes.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher.ts";
import { acquireRuntimeMarker } from "#server/app/runtime/runtime-marker.ts";
import {
  acquireEnvironmentListener,
  type EnvironmentListener,
} from "#server/app/server/environment-listener.ts";
import { branchSettlingFeature } from "#server/features/branch-settling/branch-settling.ts";
import { settleBranchesAfterFetch } from "#server/features/branch-settling/settle-after-fetch.ts";
import {
  commandProgressFeature,
  createCommandProgress,
} from "#server/features/command-progress/command-progress.ts";
import { commitInspectionFeature } from "#server/features/commit-inspection/commit-inspection.ts";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/environment-authorization.ts";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/environment-filesystem.ts";
import { fileHistoryFeature } from "#server/features/file-history/file-history.ts";
import { gitIdentityFeature } from "#server/features/git-identity/git-identity.ts";
import { pullRequestsFeature } from "#server/features/pull-requests/pull-requests.ts";
import { createRepositoryCreation } from "#server/features/repository-catalog/create-repository.ts";
import {
  createRepositoryCatalog,
  repositoryCatalogFeature,
} from "#server/features/repository-catalog/repository-catalog.ts";
import { repositoryChangesFeature } from "#server/features/repository-changes/repository-changes.ts";
import { repositoryConflictsFeature } from "#server/features/repository-conflicts/repository-conflicts.ts";
import { repositoryHistoryFeature } from "#server/features/repository-history/repository-history.feature.ts";
import { repositoryOperationsFeature } from "#server/features/repository-operations/repository-operations.ts";
import { repositoryPullFeature } from "#server/features/repository-pull/repository-pull.feature.ts";
import { repositoryPushFeature } from "#server/features/repository-push/repository-push.ts";
import { repositoryReflogFeature } from "#server/features/repository-reflog/repository-reflog.ts";
import { repositoryRefsFeature } from "#server/features/repository-refs/repository-refs.feature.ts";
import { repositoryStashesFeature } from "#server/features/repository-stashes/repository-stashes.ts";
import { repositoryWorktreesFeature } from "#server/features/repository-worktrees/repository-worktrees.ts";
import {
  createGitHostClients,
  createSourceControl,
  sourceControlFeature,
} from "#server/features/source-control/source-control.ts";
import { terminalFeature } from "#server/features/terminal/terminal.ts";
import { acquireTerminalSessions } from "#server/features/terminal/terminal-sessions.ts";
import {
  acquireEnvironmentContext,
  type EnvironmentContext,
} from "#server/persistence/environment-context.ts";
import { environmentTable } from "#server/persistence/environment-state.schema.ts";
import { environmentPaths } from "#server/persistence/storage/environment-paths.ts";
import { createRepositoryAccess } from "#server/repository/repository-access.ts";
import { createRepositoryCoordination } from "#server/repository/repository-coordination.ts";

export interface EnvironmentServerOptions {
  readonly browserAssetsRoot?: string;
  readonly home: string;
  readonly host?: string;
  readonly pairingReplacesGrantsWithSameLabel?: boolean;
  readonly port?: number;
}

export interface EnvironmentServer {
  readonly environmentId: string;
  readonly origin: string;
  readonly pairingUrl: string;
  readonly port: number;
}

type EnvironmentDependencies = Effect.Success<
  ReturnType<typeof acquireEnvironment>
>;

export function serveEnvironment(
  dependencies: EnvironmentDependencies,
  options: Omit<EnvironmentServerOptions, "home">,
) {
  return Effect.gen(function* () {
    const environment = yield* readCurrentEnvironment(dependencies.context);
    const useAutomaticPort = options.port === undefined || options.port === 0;
    const listener = yield* acquireEnvironmentListener({
      authorization: dependencies.authorization,
      ...(options.browserAssetsRoot === undefined
        ? {}
        : { browserAssetsRoot: options.browserAssetsRoot }),
      environmentId: environment.id,
      events: dependencies.events,
      features: yield* environmentFeatures(dependencies),
      ...(options.host === undefined ? {} : { host: options.host }),
      port: useAutomaticPort ? (environment.automaticPort ?? 0) : options.port,
    });

    if (useAutomaticPort && environment.automaticPort === null) {
      yield* claimAutomaticPort(dependencies.context, listener.port);
    }

    yield* acquireRuntimeMarker(
      runtimeMarker(listener),
      dependencies.paths.runtimeMarker,
    );
    const pairing = yield* dependencies.authorization.createPairing({
      replacesGrantsWithSameLabel:
        options.pairingReplacesGrantsWithSameLabel ?? false,
    });

    return {
      environmentId: environment.id,
      origin: listener.origin,
      pairingUrl: `${listener.origin}/pair#${pairing.material}`,
      port: listener.port,
    } satisfies EnvironmentServer;
  });
}

export function acquireEnvironment(home: string, git: GitCommandRunner) {
  return Effect.gen(function* () {
    const paths = environmentPaths(join(home, ".rebase"));
    const context = yield* acquireEnvironmentContext(paths);
    const catalog = createRepositoryCatalog(context, git);
    const events = createEnvironmentEventPublisher();
    return {
      access: createRepositoryAccess(catalog, git),
      authorization: createEnvironmentAuthorization(context),
      catalog,
      context,
      coordination: createRepositoryCoordination(git),
      events,
      git,
      gitHosts: createGitHostClients(),
      paths,
      progress: createCommandProgress(),
      terminals: yield* acquireTerminalSessions((repositoryId) =>
        events.publishChanged([repositoryId], "Terminals"),
      ),
      watcher: createLocalRepositoryWatcher(),
    };
  });
}

export function environmentFeatures(dependencies: EnvironmentDependencies) {
  return Effect.gen(function* () {
    const sourceControl = createSourceControl(
      dependencies.context,
      dependencies.git,
      dependencies.gitHosts,
    );
    return combineEnvironmentFeatures([
      environmentAuthorizationFeature(dependencies.authorization),
      environmentFilesystemFeature(),
      repositoryCatalogFeature(
        dependencies.catalog,
        createRepositoryCreation(dependencies),
      ),
      commitInspectionFeature(dependencies),
      fileHistoryFeature(dependencies),
      repositoryChangesFeature(dependencies),
      repositoryConflictsFeature(dependencies),
      repositoryHistoryFeature(dependencies),
      commandProgressFeature(dependencies.progress),
      repositoryOperationsFeature(dependencies),
      yield* repositoryPullFeature({
        ...dependencies,
        afterFetch: settleBranchesAfterFetch({
          ...dependencies,
          sourceControl,
        }),
      }),
      pullRequestsFeature({ ...dependencies, sourceControl }),
      repositoryPushFeature(dependencies),
      repositoryReflogFeature(dependencies),
      yield* repositoryRefsFeature(dependencies),
      branchSettlingFeature(dependencies),
      repositoryStashesFeature(dependencies),
      repositoryWorktreesFeature(dependencies),
      gitIdentityFeature(dependencies),
      sourceControlFeature({ events: dependencies.events, sourceControl }),
      terminalFeature(dependencies),
    ]);
  });
}

function runtimeMarker(listener: EnvironmentListener) {
  return {
    host: listener.host,
    origin: listener.origin,
    pid: process.pid,
    port: listener.port,
    startedAt: new Date().toISOString(),
  };
}

function readCurrentEnvironment(context: EnvironmentContext) {
  return context.read("Could not read Environment state", async (database) => {
    const environment = await database
      .select()
      .from(environmentTable)
      .where(isCurrentEnvironment())
      .get();
    if (environment === undefined) {
      throw new Error("The Environment identity is missing.");
    }
    return environment;
  });
}

function claimAutomaticPort(context: EnvironmentContext, port: number) {
  return context.write(
    "Could not save the automatic port",
    async (database) => {
      await database
        .update(environmentTable)
        .set({ automaticPort: port })
        .where(and(isCurrentEnvironment(), hasNoAutomaticPort()));
      const selected = await database
        .select({ automaticPort: environmentTable.automaticPort })
        .from(environmentTable)
        .where(isCurrentEnvironment())
        .get();
      if (selected?.automaticPort === null || selected === undefined) {
        throw new Error("The automatic port was not saved.");
      }
      if (selected.automaticPort !== port) {
        throw new Error(
          `Another server selected automatic port ${selected.automaticPort}.`,
        );
      }
    },
  );
}

function isCurrentEnvironment() {
  return eq(environmentTable.singleton, 1);
}

function hasNoAutomaticPort() {
  return isNull(environmentTable.automaticPort);
}
