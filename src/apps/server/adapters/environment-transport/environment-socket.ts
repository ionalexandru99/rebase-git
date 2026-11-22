import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/ws";
import { type WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import type {
  AnyEnvironmentRoute,
  EnvironmentRoute,
  EnvironmentStreamRoute,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  type EnvironmentChanged,
  EnvironmentSessionApi,
  environmentLivePath,
  environmentMaxMessageBytes,
  environmentProtocol,
  environmentRoutes,
  environmentSubprotocol,
  unauthorizedCloseCode,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import type { EnvironmentEventPublisher } from "#server/adapters/environment-transport/environment-event-publisher.ts";
import {
  expectedRequestOrigin,
  readSocketCredential,
  validateRequestHost,
  validateRequestOrigin,
} from "#server/adapters/environment-transport/environment-request-authorization.ts";
import {
  type ConnectionContext,
  type EnvironmentFeature,
  inRequest,
  type RequestScope,
  type RouteHandler,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type EnvironmentAuthorization,
  isEnvironmentAuthorizationError,
} from "#server/features/environment-authorization/environment-authorization.ts";

export interface EnvironmentRouterOptions {
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: EnvironmentFeature;
  readonly reportDefect?: (where: string, error: unknown) => void;
}

export type EnvironmentRouter = ReturnType<typeof environmentRouter>;

const streamWindow = 4;
const heartbeatMilliseconds = 30_000;
const maximumPendingChanges = 128;

export function attachEnvironmentSocket(
  server: Server,
  router: EnvironmentRouter,
  authorization: EnvironmentAuthorization,
  report: ReportDefect,
) {
  const handler = new RPCHandler(router);
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
    authorizeUpgrade(request, authorization).then(
      (authorized) =>
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
          authorized._tag === "Unauthorized"
            ? webSocket.close(unauthorizedCloseCode, authorized.reason)
            : serveConnection(webSocket, handler, authorization, report, {
                device: authorized.device,
                origin: expectedRequestOrigin(request),
              }),
        ),
      () => rejectUpgrade(socket),
    );
  };

  server.on("upgrade", upgrade);
  return {
    close: () => closeWebSocketServer(server, webSocketServer, upgrade),
  };
}

function serveConnection(
  webSocket: WebSocket,
  handler: RPCHandler<ConnectionContext>,
  authorization: EnvironmentAuthorization,
  report: ReportDefect,
  context: ConnectionContext,
) {
  const release = authorization.watchRevocation(context.device.id, () =>
    webSocket.close(unauthorizedCloseCode, "RevokedGrant"),
  );
  webSocket.once("close", release);
  webSocket.on("error", (error) => {
    report("WebSocket", error);
    webSocket.terminate();
  });
  void handler.upgrade(webSocket, { context });
}

async function authorizeUpgrade(
  request: IncomingMessage,
  authorization: EnvironmentAuthorization,
) {
  try {
    validateRequestHost(request);
    const { credential, cookie } = readSocketCredential(request);
    if (cookie) validateRequestOrigin(request, credential !== undefined);
    const device = await authorization.authorize(credential);
    return { _tag: "Authorized" as const, device };
  } catch (error) {
    if (!isEnvironmentAuthorizationError(error)) throw error;
    return { _tag: "Unauthorized" as const, reason: error.failure._tag };
  }
}

export function environmentRouter(options: EnvironmentRouterOptions) {
  const handlers = [...sessionHandlers(options), ...options.features.routes];
  requireEveryRoute(handlers);
  const procedure = os.$context<ConnectionContext>();
  const report = options.reportDefect ?? (() => undefined);
  return Object.fromEntries(
    handlers.map((handler) => [
      handler.route._tag,
      handler.route.stream
        ? procedure.handler(({ input, context, signal }) =>
            serveStream(
              handler as StreamHandler,
              input as AsyncIterator<unknown>,
              { ...context, signal },
              report,
            ),
          )
        : procedure.handler(({ input, context, signal }) =>
            serveRequest(
              handler as RequestHandler,
              input,
              { ...context, signal },
              report,
            ),
          ),
    ]),
  );
}

type RequestHandler = Extract<RouteHandler, { route: EnvironmentRoute }>;
type StreamHandler = Extract<RouteHandler, { route: EnvironmentStreamRoute }>;
type ProcedureContext = ConnectionContext & {
  readonly signal: AbortSignal | undefined;
};
type ReportDefect = (where: string, error: unknown) => void;

async function serveRequest(
  { route, handle }: RequestHandler,
  input: unknown,
  { signal, ...connection }: ProcedureContext,
  report: ReportDefect,
) {
  const request = parseRequest(route, input);
  const scope = scopeOf(route, request, signal);
  try {
    const value = await inRequest(scope, () =>
      handle(request, { ...connection, signal: scope.signal }),
    );
    return encode(route, value, report);
  } catch (error) {
    throw wireFailure(route, error, signal, report);
  }
}

async function* serveStream(
  { route, handle }: StreamHandler,
  events: AsyncIterator<unknown>,
  { signal, ...connection }: ProcedureContext,
  report: ReportDefect,
) {
  const first = await events.next();
  if (first.done) return;
  const request = parseRequest(route, first.value);
  const scope = scopeOf(route, request, signal);
  const values = inRequest(scope, () =>
    handle(request, { ...connection, signal: scope.signal })[
      Symbol.asyncIterator
    ](),
  );
  let credit = streamWindow;
  try {
    while (true) {
      while (credit === 0) {
        if ((await events.next()).done) return;
        credit += 1;
      }
      const next = await untilAborted(
        inRequest(scope, () => values.next()),
        scope.signal,
      );
      if (next.done) return;
      credit -= 1;
      yield encode(route, next.value, report);
    }
  } catch (error) {
    throw wireFailure(route, error, signal, report);
  } finally {
    void values.return?.();
  }
}

function untilAborted<Value>(promise: Promise<Value>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<Value>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function scopeOf(
  route: AnyEnvironmentRoute,
  request: unknown,
  signal: AbortSignal | undefined,
): RequestScope {
  const repositoryId =
    typeof request === "object" &&
    request !== null &&
    "repositoryId" in request &&
    typeof request.repositoryId === "string"
      ? request.repositoryId
      : undefined;
  return {
    procedure: route._tag,
    signal: signal ?? new AbortController().signal,
    ...(repositoryId === undefined ? {} : { repositoryId }),
  };
}

function parseRequest(route: AnyEnvironmentRoute, input: unknown) {
  const parsed = route.request.safeParse(input);
  if (!parsed.success)
    throw new ORPCError("BAD_REQUEST", { message: parsed.error.message });
  return parsed.data;
}

function encode(
  route: AnyEnvironmentRoute,
  value: unknown,
  report: ReportDefect,
) {
  if (route.success instanceof z.ZodVoid) return undefined;
  const encoded = route.success.safeParse(value);
  if (encoded.success) return encoded.data;
  report(route._tag, encoded.error);
  throw new ORPCError("INTERNAL_SERVER_ERROR");
}

function wireFailure(
  route: AnyEnvironmentRoute,
  error: unknown,
  signal: AbortSignal | undefined,
  report: ReportDefect,
) {
  if (error instanceof ORPCError) return error;
  if (!(error instanceof Error)) {
    const failure = route.failure.safeParse(error);
    if (failure.success)
      return new ORPCError("Rejected", { data: failure.data });
  }
  if (!signal?.aborted) report(route._tag, error);
  return new ORPCError("INTERNAL_SERVER_ERROR");
}

function sessionHandlers(options: EnvironmentRouterOptions): RouteHandler[] {
  return [
    {
      route: EnvironmentSessionApi.hello,
      handle: async (input) => {
        if (
          (input as { readonly protocol: number }).protocol !==
          environmentProtocol
        )
          throw {
            _tag: "ProtocolMismatch",
            serverProtocol: environmentProtocol,
          };
        return { environmentId: options.environmentId };
      },
    },
    {
      route: EnvironmentSessionApi.watch,
      handle: (_, { signal }) => environmentChanges(options.events, signal),
    },
  ];
}

async function* environmentChanges(
  events: EnvironmentEventPublisher,
  signal: AbortSignal,
) {
  const pending: EnvironmentChanged[] = [];
  let wake: (() => void) | undefined;
  const push = (change: EnvironmentChanged) => {
    if (pending.length === maximumPendingChanges) pending.shift();
    pending.push(change);
    wake?.();
  };
  const unsubscribe = events.subscribe((sequence, repositoryIds, kind) =>
    push({
      _tag: "EnvironmentChanged",
      sequence,
      ...(repositoryIds === undefined ? {} : { repositoryIds }),
      ...(kind === undefined ? {} : { kind }),
    }),
  );
  const current = () =>
    push({ _tag: "EnvironmentChanged", sequence: events.currentSequence() });
  const heartbeat = setInterval(current, heartbeatMilliseconds);
  const stop = () => wake?.();
  signal.addEventListener("abort", stop, { once: true });
  current();
  try {
    while (!signal.aborted) {
      const change = pending.shift();
      if (change !== undefined) yield change;
      else
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    }
  } finally {
    clearInterval(heartbeat);
    signal.removeEventListener("abort", stop);
    unsubscribe();
  }
}

function requireEveryRoute(handlers: readonly RouteHandler[]) {
  const served = handlers.map(({ route }) => route._tag);
  const declared = environmentRoutes.map(({ _tag }) => _tag);
  const unserved =
    served.find(
      (tag, index) => served.indexOf(tag) !== index || !declared.includes(tag),
    ) ?? declared.find((tag) => !served.includes(tag));
  if (unserved !== undefined)
    throw new Error(`Route ${unserved} must have exactly one handler.`);
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
