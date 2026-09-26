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
import { environmentFeatures } from "#server/app/server/environment-features";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import type {
  EnvironmentListener,
  EnvironmentServer,
  EnvironmentServerOptions,
} from "#server/app/server/environment-server.contract";
import type { EnvironmentServerStartError } from "#server/app/server/environment-server-error.contract";
import { EnvironmentAuthorizationAccess } from "#server/domain/environment-authorization.contract";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { environmentAuthorizationLayer } from "#server/features/environment-authorization/environment-authorization";
import { createEnvironmentIdentity } from "#server/features/environment-identity/environment-identity";
import { repositoryCatalogLayer } from "#server/features/repository-catalog/repository-catalog";
import { environmentContextLayer } from "#server/persistence/environment-context";
import { EnvironmentStorage } from "#server/persistence/environment-context.contract";
import { defaultEnvironmentPaths } from "#server/persistence/storage/environment-paths";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";
import { productVersion } from "#server/product-version";
import {
  repositoryAccessLayer,
  repositoryCoordinationLayer,
} from "#server/repository/access/index";

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
    environmentAuthorizationLayer,
    repositoryAccessLayer,
    repositoryCoordinationLayer,
  ).pipe(
    Layer.provideMerge(repositoryCatalogLayer),
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

function startEnvironment(
  options: EnvironmentServerOptions,
  paths: EnvironmentPaths,
) {
  return Effect.gen(function* () {
    const identity = createEnvironmentIdentity(yield* EnvironmentStorage);
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
      replacesGrantsWithSameLabel:
        options.pairingReplacesGrantsWithSameLabel ?? false,
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
