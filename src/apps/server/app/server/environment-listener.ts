import { createServer, type Server } from "node:http";
import { Data, Effect, FiberSet } from "effect";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import {
  createEnvironmentHttpHandler,
  type RunEnvironmentEffect,
} from "#server/adapters/environment-transport/environment-http-handler";
import { formatHostAddress } from "#server/adapters/environment-transport/environment-request-authorization";
import type { EnvironmentFeatures } from "#server/adapters/environment-transport/environment-routes";
import { attachEnvironmentSocket } from "#server/adapters/environment-transport/environment-socket";
import { errorMessage, isFileSystemError } from "#server/error-inspection";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";

export class EnvironmentServerStartError extends Data.TaggedError(
  "EnvironmentServerStartError",
)<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export interface EnvironmentListener {
  readonly host: string;
  readonly origin: string;
  readonly port: number;
  readonly server: Server;
}

interface EnvironmentListenerOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly browserAssetsRoot?: string;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: EnvironmentFeatures;
  readonly host?: string;
  readonly port?: number;
}

const loopbackHost = "127.0.0.1";

export function acquireEnvironmentListener(
  options: EnvironmentListenerOptions,
) {
  return Effect.gen(function* () {
    const host = options.host ?? loopbackHost;
    const port = options.port ?? 0;
    const runFork = yield* FiberSet.makeRuntime<never, void, never>();
    const runEnvironmentEffect: RunEnvironmentEffect = (effect, signal) => {
      runFork(effect, signal === undefined ? undefined : { signal });
    };
    const server = yield* Effect.acquireRelease(
      createHttpServer(
        options.authorization,
        host,
        port,
        runEnvironmentEffect,
        options.browserAssetsRoot,
      ),
      (acquiredServer) =>
        Effect.promise(() => closeServer(acquiredServer)).pipe(Effect.orDie),
    );
    yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          attachEnvironmentSocket(server, options, runEnvironmentEffect),
        catch: (cause) => environmentServerError(cause, host, port),
      }),
      (webSockets) => Effect.promise(webSockets.close).pipe(Effect.orDie),
    );
    yield* listen(server, host, port);
    const listeningPort = yield* readListeningPort(server, host, port);

    return {
      host,
      origin: `http://${formatHostAddress(host)}:${listeningPort}`,
      port: listeningPort,
      server,
    };
  });
}

function createHttpServer(
  authorization: EnvironmentListenerOptions["authorization"],
  host: string,
  port: number,
  runEnvironmentEffect: RunEnvironmentEffect,
  browserAssetsRoot?: string,
) {
  return Effect.try({
    try: () =>
      createServer(
        { maxHeaderSize: 16_384 },
        createEnvironmentHttpHandler(
          authorization,
          runEnvironmentEffect,
          browserAssetsRoot,
        ),
      ),
    catch: (cause) => environmentServerError(cause, host, port),
  });
}

function readListeningPort(
  server: Server,
  host: string,
  requestedPort: number,
) {
  return Effect.try({
    try: () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("The HTTP listener has no TCP address.");
      }
      return address.port;
    },
    catch: (cause) => environmentServerError(cause, host, requestedPort),
  });
}

function listen(server: Server, host: string, port: number) {
  return Effect.callback<void, EnvironmentServerStartError>(
    (resume, signal) => {
      const failed = (cause: unknown) => {
        detach();
        resume(Effect.fail(environmentServerError(cause, host, port)));
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
        server.listen({ exclusive: true, host, port, signal });
      } catch (cause) {
        failed(cause);
      }

      return Effect.sync(detach);
    },
  );
}

function closeServer(server: Server) {
  return new Promise<void>((resolveClosed, rejectClosed) => {
    server.close((error) => {
      if (error && !isServerNotRunning(error)) {
        rejectClosed(error);
      } else {
        resolveClosed();
      }
    });
    server.closeAllConnections();
  });
}

function isServerNotRunning(error: unknown) {
  return isFileSystemError(error) && error.code === "ERR_SERVER_NOT_RUNNING";
}

function environmentServerError(cause: unknown, host: string, port: number) {
  return new EnvironmentServerStartError({
    cause,
    message: listenerErrorMessage(cause, host, port),
  });
}

function listenerErrorMessage(cause: unknown, host: string, port: number) {
  if (isFileSystemError(cause) && cause.code === "EADDRINUSE" && port !== 0) {
    return `Port ${port} is already in use on ${host}.`;
  }
  if (isFileSystemError(cause) && cause.code === "EADDRNOTAVAIL") {
    return `Address ${host} is not available on this machine.`;
  }

  return `Could not start the Environment server: ${errorMessage(cause)}`;
}
