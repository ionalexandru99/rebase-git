import { createServer, type Server } from "node:http";
import { createCurrentEnvironmentDiscovery } from "@rebase/contracts";
import {
  errorMessage,
  isFileSystemError,
} from "@rebase/server/error-inspection";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-connection.contract";
import { createEnvironmentHttpHandler } from "@rebase/server/features/environment-connection/http/environment-http-handler";
import { attachEnvironmentWebSocketServer } from "@rebase/server/features/environment-connection/websocket/environment-websocket-server";
import type { EnvironmentListenerOptions } from "@rebase/server/features/environment-server/server/environment-server.contract";
import { EnvironmentServerStartError } from "@rebase/server/features/environment-server/server/environment-server-error.contract";
import { Effect } from "effect";

const loopbackHost = "127.0.0.1";

export function acquireEnvironmentListener(
  options: EnvironmentListenerOptions,
) {
  return Effect.gen(function* () {
    const port = options.port ?? 0;
    const readiness = { value: false };
    const state: EnvironmentTransportState = {
      discovery: createCurrentEnvironmentDiscovery(
        options.environmentId,
        options.productVersion,
      ),
      events: options.events,
    };
    const server = yield* Effect.acquireRelease(
      createHttpServer(readiness, state, port),
      (acquiredServer) =>
        Effect.promise(() => closeServer(acquiredServer)).pipe(Effect.orDie),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => attachEnvironmentWebSocketServer(server, state)),
      (webSockets) => Effect.promise(webSockets.close).pipe(Effect.orDie),
    );
    yield* listen(server, port);
    const listeningPort = yield* readListeningPort(server, port);

    return {
      host: loopbackHost,
      origin: `http://${loopbackHost}:${listeningPort}`,
      port: listeningPort,
      readiness,
      server,
    };
  });
}

function createHttpServer(
  readiness: { value: boolean },
  state: EnvironmentTransportState,
  port: number,
) {
  return Effect.try({
    try: () =>
      createServer(
        { maxHeaderSize: 16_384 },
        createEnvironmentHttpHandler(state, () => readiness.value),
      ),
    catch: (cause) => environmentServerError(cause, port),
  });
}

function readListeningPort(server: Server, requestedPort: number) {
  return Effect.try({
    try: () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("The HTTP listener has no TCP address.");
      }
      return address.port;
    },
    catch: (cause) => environmentServerError(cause, requestedPort),
  });
}

function listen(server: Server, port: number) {
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
