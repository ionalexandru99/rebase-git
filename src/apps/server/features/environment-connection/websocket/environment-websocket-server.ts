import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  currentTransportLimits,
  type EnvironmentAccessCapability,
  environmentLivePath,
} from "@rebase/contracts";
import { Cause, Effect } from "effect";
import { type WebSocket, WebSocketServer } from "ws";
import {
  type EnvironmentAuthorization,
  isEnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization.contract";
import type {
  EnvironmentTransportState,
  RunEnvironmentEffect,
} from "#server/features/environment-connection/environment-connection.contract";
import {
  authorizationFailureStatus,
  expectedRequestOrigin,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import { runEnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-server";

export function attachEnvironmentWebSocketServer(
  server: Server,
  state: EnvironmentTransportState,
  authorization: EnvironmentAuthorization,
  runEnvironmentEffect: RunEnvironmentEffect,
) {
  const webSocketServer = new WebSocketServer({
    clientTracking: true,
    maxPayload: currentTransportLimits.maxWebSocketRequestBytes,
    noServer: true,
    perMessageDeflate: {
      serverMaxWindowBits: 10,
      serverNoContextTakeover: true,
      threshold: 1_024,
      zlibDeflateOptions: {
        chunkSize: 1_024,
        level: 3,
        memLevel: 7,
      },
    },
  });
  const accessCapabilities = new WeakMap<
    WebSocket,
    ReadonlySet<EnvironmentAccessCapability>
  >();
  const upgrade = (
    request: Parameters<typeof webSocketServer.handleUpgrade>[0],
    socket: Duplex,
    head: Buffer,
  ) => {
    const url = readUpgradeUrl(request);
    if (url?.pathname !== environmentLivePath) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    runEnvironmentEffect(
      Effect.gen(function* () {
        yield* validateRequestHost(request);
        yield* validateRequestOrigin(request, false);
        const tickets = url.searchParams.getAll("ticket");
        const deviceAuthorization = yield* authorization.consumeTicket(
          tickets.length === 1 ? tickets[0] : undefined,
        );
        yield* Effect.sync(() => {
          webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
            accessCapabilities.set(
              webSocket,
              new Set(deviceAuthorization.capabilities),
            );
            webSocketServer.emit("connection", webSocket, request);
          });
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => rejectUpgrade(socket, Cause.squash(cause))),
        ),
      ),
    );
  };

  server.on("upgrade", upgrade);
  webSocketServer.on("connection", (socket) => {
    const address = server.address();
    if (address === null) {
      socket.close();
      return;
    }
    runEnvironmentEffect(
      runEnvironmentRpcSession(
        socket,
        state,
        typeof address === "string"
          ? { _tag: "UnixAddress", path: address }
          : {
              _tag: "TcpAddress",
              hostname: address.address,
              port: address.port,
            },
        accessCapabilities.get(socket) ?? new Set(),
      ),
    );
    accessCapabilities.delete(socket);
  });

  return {
    close: () => closeWebSocketServer(server, webSocketServer, upgrade),
  };
}

function readUpgradeUrl(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "", expectedRequestOrigin(request));
  } catch {
    return undefined;
  }
}

function rejectUpgrade(socket: Duplex, error: unknown) {
  const authorizationError = isEnvironmentAuthorizationError(error)
    ? error
    : undefined;
  const status =
    authorizationError === undefined
      ? 503
      : authorizationFailureStatus(authorizationError.failure);
  const body = JSON.stringify(
    authorizationError === undefined
      ? { _tag: "EnvironmentUnavailable" }
      : authorizationError.failure,
  );
  socket.end(
    `HTTP/1.1 ${status} ${statusText(status)}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function statusText(status: number) {
  switch (status) {
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 409:
      return "Conflict";
    case 410:
      return "Gone";
    default:
      return "Service Unavailable";
  }
}

function closeWebSocketServer(
  server: Server,
  webSocketServer: WebSocketServer,
  upgrade: Parameters<Server["on"]>[1],
) {
  server.off("upgrade", upgrade);
  for (const client of webSocketServer.clients) {
    client.terminate();
  }

  return new Promise<void>((resolveClosed, rejectClosed) => {
    webSocketServer.close((error) => {
      if (error !== undefined) {
        rejectClosed(error);
      } else {
        resolveClosed();
      }
    });
  });
}
