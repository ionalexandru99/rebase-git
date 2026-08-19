import { createServer, type Server } from "node:http";
import {
  errorMessage,
  isFileSystemError,
} from "@rebase/server/environment-server/error-inspection";
import {
  acquireRuntimeMarker,
  type RuntimeMarkerError,
} from "@rebase/server/environment-server/runtime-marker";
import {
  type RuntimeRequirementsError,
  verifyRuntimeRequirements,
} from "@rebase/server/environment-server/runtime-requirements";
import { Data, Effect, type Scope } from "effect";

const loopbackHost = "127.0.0.1";

export interface EnvironmentServerOptions {
  readonly port?: number;
}

export interface EnvironmentServer {
  readonly origin: string;
  readonly port: number;
}

export class EnvironmentServerStartError extends Data.TaggedError(
  "EnvironmentServerStartError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

interface RunningListener extends EnvironmentServer {
  readonly readiness: { value: boolean };
  readonly server: Server;
}

export function startEnvironmentServer(
  options: EnvironmentServerOptions = {},
): Effect.Effect<
  EnvironmentServer,
  EnvironmentServerStartError | RuntimeMarkerError | RuntimeRequirementsError,
  Scope.Scope
> {
  return Effect.gen(function* () {
    yield* verifyRuntimeRequirements;
    const listener = yield* acquireListener(options.port);

    yield* acquireRuntimeMarker({
      host: loopbackHost,
      origin: listener.origin,
      pid: process.pid,
      port: listener.port,
      startedAt: new Date().toISOString(),
    });
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        listener.readiness.value = false;
      }),
    );
    yield* Effect.sync(() => {
      listener.readiness.value = true;
    });

    return {
      origin: listener.origin,
      port: listener.port,
    };
  });
}

function acquireListener(port = 0) {
  return Effect.acquireRelease(startListener(port), (listener) =>
    closeServer(listener.server),
  );
}

function startListener(
  port: number,
): Effect.Effect<RunningListener, EnvironmentServerStartError> {
  return Effect.gen(function* () {
    const readiness = { value: false };
    const server = yield* Effect.try({
      try: () =>
        createServer((request, response) => {
          if (request.method === "GET" && request.url === "/health") {
            response.writeHead(readiness.value ? 200 : 503, {
              "content-type": "application/json; charset=utf-8",
            });
            response.end(
              JSON.stringify({
                status: readiness.value ? "ready" : "starting",
              }),
            );
            return;
          }

          response.writeHead(404).end();
        }),
      catch: (cause) => environmentServerError(cause, port),
    });

    yield* listen(server, port);

    const address = server.address();
    if (address === null || typeof address === "string") {
      return yield* Effect.fail(
        environmentServerError(
          new Error("The HTTP listener has no TCP address."),
          port,
        ),
      );
    }

    return {
      origin: `http://${loopbackHost}:${address.port}`,
      port: address.port,
      readiness,
      server,
    };
  });
}

function listen(server: Server, port = 0) {
  return Effect.callback<void, EnvironmentServerStartError>(
    (resume, signal) => {
      const failed = (cause: unknown) => {
        detach();
        resume(Effect.fail(environmentServerError(cause, port)));
      };
      const listening = () => {
        detach();
        resume(Effect.void);
      };
      const detach = () => {
        server.off("error", failed);
        server.off("listening", listening);
      };

      server.once("error", failed);
      server.once("listening", listening);
      try {
        server.listen({ exclusive: true, host: loopbackHost, port, signal });
      } catch (cause) {
        failed(cause);
      }

      return Effect.sync(detach);
    },
  );
}

function closeServer(server: Server) {
  return Effect.callback<void>((resume) => {
    server.close((error) => {
      resume(
        error && !isServerNotRunning(error) ? Effect.die(error) : Effect.void,
      );
    });
    server.closeAllConnections();
  });
}

function isServerNotRunning(error: unknown) {
  return isFileSystemError(error) && error.code === "ERR_SERVER_NOT_RUNNING";
}

function environmentServerError(cause: unknown, port: number) {
  return new EnvironmentServerStartError({
    cause,
    message: listenerErrorMessage(cause, port),
  });
}

function listenerErrorMessage(cause: unknown, port: number) {
  if (isFileSystemError(cause) && cause.code === "EADDRINUSE" && port !== 0) {
    return `Port ${port} is already in use on ${loopbackHost}.`;
  }

  return `Could not start the Environment server: ${errorMessage(cause)}`;
}
