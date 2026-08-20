import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { EnvironmentListener } from "@rebase/server/environment-server/environment-listener.contract";
import { EnvironmentServerStartError } from "@rebase/server/environment-server/environment-server-start-error";
import {
  errorMessage,
  isFileSystemError,
} from "@rebase/server/environment-server/error-inspection";
import { Effect } from "effect";

const loopbackHost = "127.0.0.1";

export function acquireEnvironmentListener(port = 0) {
  return Effect.acquireRelease(startListener(port), (listener) =>
    closeServer(listener.server),
  );
}

function startListener(
  port: number,
): Effect.Effect<EnvironmentListener, EnvironmentServerStartError> {
  return Effect.gen(function* () {
    const readiness = { value: false };
    const server = yield* createHttpServer(readiness, port);
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

function createHttpServer(readiness: { value: boolean }, port: number) {
  return Effect.try({
    try: () =>
      createServer((request, response) =>
        respondToRequest(request, response, readiness.value),
      ),
    catch: (cause) => environmentServerError(cause, port),
  });
}

function respondToRequest(
  request: IncomingMessage,
  response: ServerResponse,
  ready: boolean,
) {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }

  response.writeHead(ready ? 200 : 503, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ status: ready ? "ready" : "starting" }));
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
