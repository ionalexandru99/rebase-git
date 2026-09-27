import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { combineEnvironmentFeatures } from "#server/adapters/environment-transport/combine-environment-features";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/git-commands";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import {
  acquireRuntimeMarker,
  type RuntimeMarkerError,
} from "#server/app/runtime/runtime-marker";
import {
  type RuntimeRequirementsError,
  verifyRuntimeRequirements,
} from "#server/app/runtime/runtime-requirements";
import {
  acquireEnvironmentListener,
  type EnvironmentListener,
  type EnvironmentServerStartError,
} from "#server/app/server/environment-listener";
import { commitInspectionFeature } from "#server/features/commit-inspection/commit-inspection.feature";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import { environmentAuthorizationFeature } from "#server/features/environment-authorization/environment-authorization.feature";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/environment-filesystem.feature";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { repositoryCatalogFeature } from "#server/features/repository-catalog/repository-catalog.feature";
import { repositoryChangesFeature } from "#server/features/repository-changes/repository-changes.feature";
import { repositoryConflictsFeature } from "#server/features/repository-conflicts/repository-conflicts.feature";
import {
  repositoryFreshnessFeature,
  repositoryHistoryFeature,
} from "#server/features/repository-history/repository-history.feature";
import { repositoryOperationsFeature } from "#server/features/repository-operations/repository-operations.feature";
import { repositoryPullFeature } from "#server/features/repository-pull/repository-pull.feature";
import { repositoryPushFeature } from "#server/features/repository-push/repository-push.feature";
import { repositoryRefsFeature } from "#server/features/repository-refs/repository-refs.feature";
import {
  acquireEnvironmentContext,
  type EnvironmentContext,
} from "#server/persistence/environment-context";
import { environmentTable } from "#server/persistence/environment-state.schema";
import type { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { productVersion } from "#server/product-version";
import { createRepositoryAccess } from "#server/repository/repository-access";
import { createRepositoryCoordination } from "#server/repository/repository-coordination";

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

export function startEnvironmentServer(
  options: EnvironmentServerOptions,
): Effect.Effect<
  EnvironmentServer,
  | EnvironmentServerStartError
  | EnvironmentStorageError
  | RuntimeMarkerError
  | RuntimeRequirementsError,
  Scope.Scope
> {
  return Effect.gen(function* () {
    yield* verifyRuntimeRequirements;
    return yield* serveEnvironment(
      yield* acquireEnvironment(options.home),
      options,
    );
  });
}

export function serveEnvironment(
  dependencies: EnvironmentDependencies,
  options: Omit<EnvironmentServerOptions, "home">,
) {
  return Effect.gen(function* () {
    const identity = createEnvironmentIdentity(dependencies.context);
    const environment = yield* identity.current();
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
      productVersion,
    });

    if (useAutomaticPort && environment.automaticPort === null) {
      yield* identity.claimAutomaticPort(listener.port);
    }

    yield* acquireRuntimeMarker(
      runtimeMarker(listener),
      dependencies.paths.runtimeMarker,
    );
    const pairing = yield* dependencies.authorization.createPairing({
      replacesGrantsWithSameLabel:
        options.pairingReplacesGrantsWithSameLabel ?? false,
    });
    yield* markListenerReady(listener);

    return {
      environmentId: environment.id,
      origin: listener.origin,
      pairingUrl: `${listener.origin}/pair#${pairing.material}`,
      port: listener.port,
    } satisfies EnvironmentServer;
  });
}

export function acquireEnvironment(home: string) {
  return Effect.gen(function* () {
    const paths = environmentPaths(join(home, ".rebase"));
    const context = yield* acquireEnvironmentContext(paths);
    const git = createLocalGitCommandRunner();
    const watcher = createLocalRepositoryWatcher();
    const catalog = createRepositoryCatalog(context, git);
    return {
      access: createRepositoryAccess(catalog, git, watcher),
      authorization: createEnvironmentAuthorization(context),
      catalog,
      context,
      coordination: createRepositoryCoordination(git),
      events: createEnvironmentEventPublisher(),
      git,
      paths,
      watcher,
    };
  });
}

export function environmentFeatures(dependencies: EnvironmentDependencies) {
  return Effect.gen(function* () {
    return combineEnvironmentFeatures([
      environmentAuthorizationFeature(dependencies.authorization),
      environmentFilesystemFeature(),
      repositoryCatalogFeature(dependencies.catalog),
      commitInspectionFeature(dependencies),
      repositoryChangesFeature(dependencies),
      repositoryConflictsFeature(dependencies),
      repositoryHistoryFeature(dependencies),
      yield* repositoryFreshnessFeature(dependencies),
      repositoryOperationsFeature(dependencies),
      repositoryPullFeature(dependencies),
      repositoryPushFeature(dependencies),
      yield* repositoryRefsFeature(dependencies),
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

function markListenerReady(listener: EnvironmentListener) {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        listener.readiness.value = false;
      }),
    );
    yield* Effect.sync(() => {
      listener.readiness.value = true;
    });
  });
}

function createEnvironmentIdentity(context: EnvironmentContext) {
  return {
    current: () => readCurrentEnvironment(context),
    claimAutomaticPort: (port: number) => claimAutomaticPort(context, port),
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
