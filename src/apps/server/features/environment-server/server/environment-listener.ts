import { createServer, type Server } from "node:http";
import { createCurrentEnvironmentDiscovery } from "@rebase/contracts";
import { Effect, FiberSet } from "effect";
import { errorMessage, isFileSystemError } from "#server/error-inspection";
import type {
  EnvironmentTransportState,
  RunEnvironmentEffect,
} from "#server/features/environment-connection/environment-connection.contract";
import { formatHostAddress } from "#server/features/environment-connection/environment-request-authorization";
import { createEnvironmentHttpHandler } from "#server/features/environment-connection/http/environment-http-handler";
import { attachEnvironmentWebSocketServer } from "#server/features/environment-connection/websocket/environment-websocket-server";
import type { EnvironmentListenerOptions } from "#server/features/environment-server/server/environment-server.contract";
import { EnvironmentServerStartError } from "#server/features/environment-server/server/environment-server-error.contract";

const loopbackHost = "127.0.0.1";

export function acquireEnvironmentListener(
  options: EnvironmentListenerOptions,
) {
  return Effect.gen(function* () {
    const host = options.host ?? loopbackHost;
    const port = options.port ?? 0;
    const readiness = { value: false };
    const discovery = createCurrentEnvironmentDiscovery(
      options.environmentId,
      options.productVersion,
    );
    const state: EnvironmentTransportState = {
      discovery: {
        ...discovery,
        capabilities: discovery.capabilities.filter(
          (capability) =>
            (capability.name !== "repository-history" ||
              options.history !== undefined) &&
            (capability.name !== "repository-history-freshness" ||
              options.freshness !== undefined),
        ),
      },
      events: options.events,
      ...(options.history === undefined ? {} : { history: options.history }),
      ...(options.freshness === undefined
        ? {}
        : { freshness: options.freshness }),
    };
    const runFork = yield* FiberSet.makeRuntime<never, void, never>();
    const runEnvironmentEffect: RunEnvironmentEffect = (effect, signal) => {
      runFork(effect, signal === undefined ? undefined : { signal });
    };
    const server = yield* Effect.acquireRelease(
      createHttpServer(
        readiness,
        state,
        options.authorization,
        options.catalog,
        options.filesystem,
        options.refs,
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
          attachEnvironmentWebSocketServer(
            server,
            state,
            options.authorization,
            runEnvironmentEffect,
          ),
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
      readiness,
      server,
    };
  });
}

function createHttpServer(
  readiness: { value: boolean },
  state: EnvironmentTransportState,
  authorization: EnvironmentListenerOptions["authorization"],
  catalog: EnvironmentListenerOptions["catalog"],
  filesystem: EnvironmentListenerOptions["filesystem"],
  refs: EnvironmentListenerOptions["refs"],
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
          state,
          authorization,
          catalog,
          filesystem,
          refs,
          () => readiness.value,
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
