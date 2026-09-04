import { and } from "drizzle-orm";
import { Effect, type Scope } from "effect";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import type { Environment } from "#server/domain/environment-state.contract";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { createEnvironmentFilesystem } from "#server/features/environment-filesystem/environment-filesystem";
import {
  hasNoAutomaticPort,
  isCurrentEnvironment,
} from "#server/features/environment-server/environment-state.specifications";
import type {
  RuntimeMarkerError,
  RuntimeRequirementsError,
} from "#server/features/environment-server/runtime/runtime-errors.contract";
import { acquireRuntimeMarker } from "#server/features/environment-server/runtime/runtime-marker";
import type { RuntimeMarker } from "#server/features/environment-server/runtime/runtime-marker.contract";
import { verifyRuntimeRequirements } from "#server/features/environment-server/runtime/runtime-requirements";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import type {
  EnvironmentListener,
  EnvironmentServer,
  EnvironmentServerOptions,
} from "#server/features/environment-server/server/environment-server.contract";
import type { EnvironmentServerStartError } from "#server/features/environment-server/server/environment-server-error.contract";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { acquireRepositoryFreshnessService } from "#server/features/repository-history/freshness/repository-freshness";
import { createRepositoryHistoryService } from "#server/features/repository-history/repository-history";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import type { EnvironmentContext } from "#server/persistence/environment-context.contract";
import { environmentTable } from "#server/persistence/environment-state.schema";
import { defaultEnvironmentPaths } from "#server/persistence/storage/environment-paths";
import type { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";
import { productVersion } from "#server/product-version";

export function startEnvironmentServer(
  options: EnvironmentServerOptions = {},
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
    const paths = defaultEnvironmentPaths();
    const context = yield* acquireEnvironmentContext(paths);
    const catalog = createRepositoryCatalog(context);
    const environment = yield* readCurrentEnvironment(context);
    const authorization = createEnvironmentAuthorization(
      context,
      context.serverSecret,
    );
    const useAutomaticPort = options.port === undefined || options.port === 0;
    const requestedPort = useAutomaticPort
      ? (environment.automaticPort ?? 0)
      : options.port;
    const events = createEnvironmentEventPublisher();
    const git = createLocalGitCommandRunner();
    const refs = createRepositoryRefsService({
      catalog,
      changes: yield* acquireRepositoryChangePublisher(
        git,
        createLocalRepositoryWatcher(),
        events,
      ),
      git,
    });
    const listener = yield* acquireEnvironmentListener({
      authorization,
      catalog,
      ...(options.browserAssetsRoot === undefined
        ? {}
        : { browserAssetsRoot: options.browserAssetsRoot }),
      environmentId: environment.id,
      events,
      filesystem: createEnvironmentFilesystem(),
      history: createRepositoryHistoryService({ catalog, git }),
      freshness: yield* acquireRepositoryFreshnessService({
        catalog,
        git,
        watcher: createLocalRepositoryWatcher(),
      }),
      ...(options.host === undefined ? {} : { host: options.host }),
      port: requestedPort,
      productVersion,
      refs,
    });

    if (useAutomaticPort && environment.automaticPort === null) {
      yield* claimAutomaticPort(context, listener.port);
    }

    yield* acquireRuntimeMarker(runtimeMarker(listener), paths.runtimeMarker);
    const pairing = yield* authorization.createPairing({
      capabilities: [],
      role: "owner",
    });
    yield* markListenerReady(listener);

    return {
      environmentId: environment.id,
      origin: listener.origin,
      pairingUrl: `${listener.origin}/pair#${pairing.material}`,
      port: listener.port,
    };
  });
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
    return environment satisfies Environment;
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

function runtimeMarker(listener: EnvironmentListener): RuntimeMarker {
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
