import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  type Cause,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Queue,
  Stream,
} from "effect";
import { NetAddress } from "effect/net";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";
import { type WebSocket, WebSocketServer } from "ws";
import {
  type EnvironmentChanged,
  EnvironmentRpc,
  environmentLivePath,
  environmentMaxMessageBytes,
  environmentProtocol,
  environmentSubprotocol,
  type ProtocolMismatch,
  unauthorizedCloseCode,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import type { RunEnvironmentEffect } from "#server/adapters/environment-transport/environment-http-handler.ts";
import {
  expectedRequestOrigin,
  readSocketCredential,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization.ts";
import type {
  EnvironmentFeatures,
  RouteContext,
} from "#server/adapters/environment-transport/environment-routes.ts";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.ts";

export interface EnvironmentSocketOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: EnvironmentFeatures;
  readonly reportDefect?: (where: string, cause: Cause.Cause<unknown>) => void;
}

export function attachEnvironmentSocket(
  server: Server,
  options: EnvironmentSocketOptions,
  runEnvironmentEffect: RunEnvironmentEffect,
) {
  requireEveryProcedure(options.features);
  const webSocketServer = new WebSocketServer({
    clientTracking: true,
    handleProtocols: (protocols) =>
      protocols.has(environmentSubprotocol) ? environmentSubprotocol : false,
    maxPayload: environmentMaxMessageBytes,
    noServer: true,
    perMessageDeflate: {
      serverMaxWindowBits: 10,
      serverNoContextTakeover: true,
      threshold: 1_024,
      zlibDeflateOptions: { chunkSize: 1_024, level: 3, memLevel: 7 },
    },
  });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    if (upgradePath(request) !== environmentLivePath) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    runEnvironmentEffect(
      authorizeUpgrade(request, options.authorization).pipe(
        Effect.matchCause({
          onFailure: () => rejectUpgrade(socket),
          onSuccess: (authorized) =>
            webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
              authorized._tag === "Unauthorized"
                ? webSocket.close(unauthorizedCloseCode, authorized.reason)
                : runEnvironmentEffect(
                    serveEnvironmentRpc(webSocket, server, options, {
                      device: authorized.device,
                      origin: expectedRequestOrigin(request),
                    }),
                  ),
            ),
        }),
      ),
    );
  };

  server.on("upgrade", upgrade);
  return {
    close: () => closeWebSocketServer(server, webSocketServer, upgrade),
  };
}

function authorizeUpgrade(
  request: IncomingMessage,
  authorization: EnvironmentAuthorization,
) {
  return Effect.gen(function* () {
    yield* validateRequestHost(request);
    const { credential, cookie } = readSocketCredential(request);
    if (cookie) yield* validateRequestOrigin(request, credential !== undefined);
    return yield* authorization.authorize(credential);
  }).pipe(
    Effect.map((device) => ({ _tag: "Authorized" as const, device })),
    Effect.catchTag("EnvironmentAuthorizationError", (error) =>
      Effect.succeed({
        _tag: "Unauthorized" as const,
        reason: error.failure._tag,
      }),
    ),
  );
}

function serveEnvironmentRpc(
  socket: WebSocket,
  server: Server,
  options: EnvironmentSocketOptions,
  context: RouteContext,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
    yield* closeOnRevocation(socket, options.authorization, context.device.id);
    const handlers = yield* environmentRpcHandlers(options, context);
    const transport = yield* Socket.fromWebSocket(
      Effect.acquireRelease(
        Effect.succeed(socket as unknown as globalThis.WebSocket),
        () => Effect.sync(() => socket.close()),
      ),
    );
    const socketServer = Layer.succeed(SocketServer.SocketServer)({
      address: socketAddress(server),
      run: (handler) =>
        handler(transport).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              options.reportDefect?.("WebSocket", cause);
              socket.close(1011);
            }),
          ),
          Effect.ensuring(Deferred.succeed(disconnected, undefined)),
          Effect.andThen(Effect.never),
        ),
    });
    const serving = yield* RpcServer.make(EnvironmentRpc, {
      disableFatalDefects: true,
    }).pipe(
      Effect.provide(handlers),
      Effect.provide(
        RpcServer.layerProtocolSocketServer.pipe(
          Layer.provide(socketServer),
          Layer.provide(RpcSerialization.layerJson),
        ),
      ),
      Effect.forkScoped,
    );
    yield* Deferred.await(disconnected).pipe(
      Effect.raceFirst(Fiber.join(serving)),
    );
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        options.reportDefect?.("WebSocket", cause);
        socket.close(1011);
      }),
    ),
  );
}

function closeOnRevocation(
  socket: WebSocket,
  authorization: EnvironmentAuthorization,
  authorizationId: string,
) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      authorization.watchRevocation(authorizationId, () =>
        socket.close(unauthorizedCloseCode, "RevokedGrant"),
      ),
    ),
    (release) => Effect.sync(release),
  );
}

export function environmentRpcHandlers(
  options: EnvironmentSocketOptions,
  context: RouteContext,
) {
  return Effect.map(subscribeEnvironmentChanges(options.events), (changes) =>
    EnvironmentRpc.toLayer({
      ...options.features.rpc(),
      ...Object.fromEntries(
        options.features.routes.map(({ route, handle }) => [
          route._tag,
          (input: unknown) => handle(input, context),
        ]),
      ),
      Hello: ({ protocol }: { readonly protocol: number }) =>
        protocol === environmentProtocol
          ? Effect.sync(() => ({
              environmentId: options.environmentId,
              sequence: options.events.currentSequence(),
            }))
          : Effect.fail<ProtocolMismatch>({
              _tag: "ProtocolMismatch",
              serverProtocol: environmentProtocol,
            }),
      WatchEnvironment: () => Stream.fromQueue(changes),
    } as never),
  );
}

function subscribeEnvironmentChanges(events: EnvironmentEventPublisher) {
  return Effect.gen(function* () {
    const queue = yield* Queue.sliding<EnvironmentChanged>(128);
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        events.subscribe((sequence, repositoryIds, kind) => {
          Queue.offerUnsafe(queue, {
            _tag: "EnvironmentChanged",
            sequence,
            ...(repositoryIds === undefined ? {} : { repositoryIds }),
            ...(kind === undefined ? {} : { kind }),
          });
        }),
      ),
      (release) => Effect.sync(release),
    );
    return queue;
  });
}

function requireEveryProcedure(features: EnvironmentFeatures) {
  const served = [
    "Hello",
    "WatchEnvironment",
    ...Object.keys(features.rpc()),
    ...features.routes.map(({ route }) => route._tag),
  ];
  const declared = [...EnvironmentRpc.requests.keys()];
  const unserved =
    served.find(
      (tag, index) => served.indexOf(tag) !== index || !declared.includes(tag),
    ) ?? declared.find((tag) => !served.includes(tag));
  if (unserved !== undefined)
    throw new Error(`Procedure ${unserved} must have exactly one handler.`);
}

function socketAddress(server: Server): NetAddress.SocketAddress {
  const address = server.address();
  return typeof address === "string" || address === null
    ? NetAddress.unixPathAddress(String(address))
    : NetAddress.inetAddressFromIpStringUnsafe(address.address, address.port);
}

function upgradePath(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "", expectedRequestOrigin(request)).pathname;
  } catch {
    return undefined;
  }
}

function rejectUpgrade(socket: Duplex) {
  if (socket.destroyed || !socket.writable) return;
  const body = JSON.stringify({ _tag: "EnvironmentUnavailable" });
  socket.end(
    `HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

function closeWebSocketServer(
  server: Server,
  webSocketServer: WebSocketServer,
  upgrade: Parameters<Server["on"]>[1],
) {
  server.off("upgrade", upgrade);
  for (const client of webSocketServer.clients) client.terminate();
  return new Promise<void>((resolveClosed, rejectClosed) => {
    webSocketServer.close((error) => {
      if (error === undefined) resolveClosed();
      else rejectClosed(error);
    });
  });
}
