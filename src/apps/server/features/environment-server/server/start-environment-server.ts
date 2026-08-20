import type { Environment } from "@rebase/server/domain/environment-state.contract";
import {
  hasNoAutomaticPort,
  isCurrentEnvironment,
} from "@rebase/server/features/environment-server/environment-state.specifications";
import type {
  RuntimeMarkerError,
  RuntimeRequirementsError,
} from "@rebase/server/features/environment-server/runtime/runtime-errors.contract";
import { acquireRuntimeMarker } from "@rebase/server/features/environment-server/runtime/runtime-marker";
import type { RuntimeMarker } from "@rebase/server/features/environment-server/runtime/runtime-marker.contract";
import { verifyRuntimeRequirements } from "@rebase/server/features/environment-server/runtime/runtime-requirements";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import type {
  EnvironmentListener,
  EnvironmentServer,
  EnvironmentServerOptions,
} from "@rebase/server/features/environment-server/server/environment-server.contract";
import type { EnvironmentServerStartError } from "@rebase/server/features/environment-server/server/environment-server-error.contract";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import { environmentTable } from "@rebase/server/persistence/environment-state.schema";
import { defaultEnvironmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import type { EnvironmentStorageError } from "@rebase/server/persistence/storage/storage-error.contract";
import { and } from "drizzle-orm";
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
    const context = yield* acquireEnvironmentContext(paths);
    const environment = yield* readCurrentEnvironment(context);
    const useAutomaticPort = options.port === undefined || options.port === 0;
    const requestedPort = useAutomaticPort
      ? (environment.automaticPort ?? 0)
      : options.port;
    const listener = yield* acquireEnvironmentListener(requestedPort);

    if (useAutomaticPort && environment.automaticPort === null) {
      yield* claimAutomaticPort(context, listener.port);
    }

    yield* acquireRuntimeMarker(runtimeMarker(listener), paths.runtimeMarker);
    yield* markListenerReady(listener);

    return {
      environmentId: environment.id,
      origin: listener.origin,
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
