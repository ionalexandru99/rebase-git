import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  type EnvironmentChanged,
  EnvironmentRpc,
  environmentLivePath,
  environmentMaxMessageBytes,
  environmentProtocol,
  environmentSubprotocol,
  type ProtocolMismatch,
  unauthorizedCloseCode,
} from "@rebase/contracts";
import { Cause, Deferred, Effect, Fiber, Layer, Queue, Stream } from "effect";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import { type WebSocket, WebSocketServer } from "ws";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher";
import type { RunEnvironmentEffect } from "#server/adapters/environment-transport/environment-http-handler";
import {
  accessFailureStatus,
  expectedRequestOrigin,
  readSocketCredential,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization";
import type {
  EnvironmentFeatures,
  RouteContext,
} from "#server/adapters/environment-transport/environment-routes";
import {
  type EnvironmentAuthorization,
  EnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization";

export interface EnvironmentSocketOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: EnvironmentFeatures;
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
  const accept = (request: IncomingMessage, socket: Duplex, head: Buffer) =>
    Effect.callback<WebSocket>((resume) => {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
        resume(Effect.succeed(webSocket)),
      );
    });
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (upgradePath(request) !== environmentLivePath) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    runEnvironmentEffect(
      authorizeUpgrade(request, options.authorization).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Effect.sync(() => rejectUpgrade(socket, Cause.squash(cause))),
          onSuccess: (authorized) =>
            accept(request, socket, head).pipe(
              Effect.flatMap((webSocket) =>
                authorized._tag === "Unauthorized"
                  ? Effect.sync(() =>
                      webSocket.close(unauthorizedCloseCode, authorized.reason),
                    )
                  : serveEnvironmentRpc(webSocket, server, options, {
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
    yield* validateRequestOrigin(request, cookie && credential !== undefined);
    return yield* authorization.authorize(credential).pipe(
      Effect.map((device) => ({ _tag: "Authorized" as const, device })),
      Effect.catchTag("EnvironmentAuthorizationError", (error) =>
        Effect.succeed({
          _tag: "Unauthorized" as const,
          reason: error.failure._tag,
        }),
      ),
    );
  });
}

function serveEnvironmentRpc(
  socket: WebSocket,
  server: Server,
  options: EnvironmentSocketOptions,
  context: RouteContext,
) {
  return Effect.gen(function* () {
    const disconnected = yield* Deferred.make<void>();
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
          Effect.catchCause(() => Effect.sync(() => socket.close(1011))),
          Effect.ensuring(Deferred.succeed(disconnected, undefined)),
          Effect.andThen(Effect.never),
        ),
    });
    const serving = yield* RpcServer.make(EnvironmentRpc).pipe(
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
    Effect.catchCause(() => Effect.sync(() => socket.close(1011))),
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

function socketAddress(server: Server): SocketServer.Address {
  const address = server.address();
  return typeof address === "string" || address === null
    ? { _tag: "UnixAddress", path: String(address) }
    : { _tag: "TcpAddress", hostname: address.address, port: address.port };
}

function upgradePath(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "", expectedRequestOrigin(request)).pathname;
  } catch {
    return undefined;
  }
}

function rejectUpgrade(socket: Duplex, error: unknown) {
  if (socket.destroyed || !socket.writable) return;
  const failure =
    error instanceof EnvironmentAuthorizationError ? error.failure : undefined;
  const status = failure === undefined ? 503 : accessFailureStatus(failure);
  const body = JSON.stringify(failure ?? { _tag: "EnvironmentUnavailable" });
  socket.end(
    `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Service Unavailable"}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
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
