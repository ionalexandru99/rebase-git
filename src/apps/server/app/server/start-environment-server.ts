import { Effect, Layer, type Scope } from "effect";
import { environmentEventPublisherLayer } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { localGitCommandRunnerLayer } from "#server/adapters/local-git/local-git-command-runner";
import { localRepositoryWatcherLayer } from "#server/adapters/local-git/local-repository-watcher";
import type {
  RuntimeMarkerError,
  RuntimeRequirementsError,
} from "#server/app/runtime/runtime-errors.contract";
import { acquireRuntimeMarker } from "#server/app/runtime/runtime-marker";
import type { RuntimeMarker } from "#server/app/runtime/runtime-marker.contract";
import { verifyRuntimeRequirements } from "#server/app/runtime/runtime-requirements";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import type {
  EnvironmentListener,
  EnvironmentServer,
  EnvironmentServerOptions,
} from "#server/app/server/environment-server.contract";
import type { EnvironmentServerStartError } from "#server/app/server/environment-server-error.contract";
import { CommitInspectionAccess } from "#server/domain/commit-inspection.contract";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import { EnvironmentFilesystemAccess } from "#server/domain/environment-filesystem.contract";
import { EnvironmentIdentity } from "#server/domain/environment-identity.contract";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import { RepositoryChangesAccess } from "#server/domain/repository-changes.contract";
import { RepositoryFreshnessState } from "#server/domain/repository-freshness.contract";
import { RepositoryHistoryAccess } from "#server/domain/repository-history.contract";
import { RepositoryRefsAccess } from "#server/domain/repository-refs.contract";
import {
  commitInspectionFeature,
  commitInspectionLayer,
} from "#server/features/commit-inspection/index";
import { EnvironmentAuthorizationAccess } from "#server/features/environment-authorization/environment-authorization.contract";
import {
  environmentAuthorizationFeature,
  environmentAuthorizationLayer,
} from "#server/features/environment-authorization/index";
import {
  environmentFilesystemFeature,
  environmentFilesystemLayer,
} from "#server/features/environment-filesystem/index";
import { environmentIdentityLayer } from "#server/features/environment-identity/index";
import { repositoryAccessLayer } from "#server/features/repository-access/index";
import {
  repositoryCatalogFeature,
  repositoryCatalogLayer,
} from "#server/features/repository-catalog/index";
import {
  repositoryChangesFeature,
  repositoryChangesLayer,
} from "#server/features/repository-changes/index";
import { repositoryCoordinationLayer } from "#server/features/repository-coordination/index";
import {
  repositoryFreshnessFeature,
  repositoryFreshnessLayer,
  repositoryHistoryFeature,
  repositoryHistoryLayer,
} from "#server/features/repository-history/index";
import {
  repositoryChangePublisherLayer,
  repositoryRefsFeature,
  repositoryRefsLayer,
} from "#server/features/repository-refs/index";
import { environmentContextLayer } from "#server/persistence/environment-context";
import { defaultEnvironmentPaths } from "#server/persistence/storage/environment-paths";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";
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
    const services = yield* Layer.build(environmentLayer(paths));
    return yield* startEnvironment(options, paths).pipe(
      Effect.provide(services),
    );
  });
}

function environmentLayer(paths: EnvironmentPaths) {
  return Layer.mergeAll(
    environmentIdentityLayer,
    environmentAuthorizationLayer,
    environmentFilesystemLayer,
    commitInspectionLayer,
    repositoryChangesLayer,
    repositoryHistoryLayer,
    repositoryFreshnessLayer,
    repositoryRefsLayer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(repositoryAccessLayer, repositoryChangePublisherLayer),
    ),
    Layer.provideMerge(
      Layer.mergeAll(repositoryCatalogLayer, repositoryCoordinationLayer),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        localGitCommandRunnerLayer,
        localRepositoryWatcherLayer,
        environmentEventPublisherLayer,
        environmentContextLayer(paths),
      ),
    ),
  );
}

const environmentFeatures = Effect.all([
  Effect.map(EnvironmentAuthorizationAccess, environmentAuthorizationFeature),
  Effect.map(EnvironmentFilesystemAccess, environmentFilesystemFeature),
  Effect.map(RepositoryCatalogAccess, repositoryCatalogFeature),
  Effect.map(CommitInspectionAccess, commitInspectionFeature),
  Effect.map(RepositoryChangesAccess, repositoryChangesFeature),
  Effect.map(RepositoryHistoryAccess, repositoryHistoryFeature),
  Effect.map(RepositoryFreshnessState, repositoryFreshnessFeature),
  Effect.map(RepositoryRefsAccess, repositoryRefsFeature),
]);

function startEnvironment(
  options: EnvironmentServerOptions,
  paths: EnvironmentPaths,
) {
  return Effect.gen(function* () {
    const identity = yield* EnvironmentIdentity;
    const authorization = yield* EnvironmentAuthorizationAccess;
    const environment = yield* identity.current();
    const useAutomaticPort = options.port === undefined || options.port === 0;
    const requestedPort = useAutomaticPort
      ? (environment.automaticPort ?? 0)
      : options.port;
    const listener = yield* acquireEnvironmentListener({
      authorization,
      ...(options.browserAssetsRoot === undefined
        ? {}
        : { browserAssetsRoot: options.browserAssetsRoot }),
      environmentId: environment.id,
      events: yield* EnvironmentEvents,
      features: yield* environmentFeatures,
      ...(options.host === undefined ? {} : { host: options.host }),
      port: requestedPort,
      productVersion,
    });

    if (useAutomaticPort && environment.automaticPort === null) {
      yield* identity.claimAutomaticPort(listener.port);
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
    } satisfies EnvironmentServer;
  });
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
