import type {
  RuntimeMarkerError,
  RuntimeRequirementsError,
} from "@rebase/server/environment-server/runtime/runtime-errors";
import { acquireRuntimeMarker } from "@rebase/server/environment-server/runtime/runtime-marker";
import type { RuntimeMarker } from "@rebase/server/environment-server/runtime/runtime-marker.contract";
import { verifyRuntimeRequirements } from "@rebase/server/environment-server/runtime/runtime-requirements";
import { acquireEnvironmentListener } from "@rebase/server/environment-server/server/environment-listener";
import type {
  EnvironmentListener,
  EnvironmentServer,
  EnvironmentServerOptions,
} from "@rebase/server/environment-server/server/environment-server.contract";
import type { EnvironmentServerStartError } from "@rebase/server/environment-server/server/environment-server-error";
import { acquireEnvironmentState } from "@rebase/server/environment-server/state/environment-state";
import { defaultEnvironmentPaths } from "@rebase/server/environment-server/storage/environment-paths";
import type { EnvironmentStorageError } from "@rebase/server/environment-server/storage/storage-error";
import { Effect, type Scope } from "effect";

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
    const state = yield* acquireEnvironmentState(paths);
    const requestedPort = options.port ?? state.automaticPort ?? 0;
    const listener = yield* acquireEnvironmentListener(requestedPort);

    if (options.port === undefined && state.automaticPort === null) {
      yield* state.selectAutomaticPort(listener.port);
    }

    yield* acquireRuntimeMarker(runtimeMarker(listener), paths.runtimeMarker);
    yield* markListenerReady(listener);

    return {
      environmentId: state.environmentId,
      origin: listener.origin,
      port: listener.port,
    };
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
