import {
  type EnvironmentDiscovery,
  type EnvironmentHello,
  EnvironmentHelloResult,
  EnvironmentHello as EnvironmentHelloSchema,
  EnvironmentServerMessage,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import {
  type EnvironmentConnectionFailure,
  EnvironmentHelloRejected,
  environmentResponseError,
} from "@rebase/web/state/server/environment-connection/environment-connection-errors";
import type { NegotiatedEnvironment } from "@rebase/web/state/server/environment-connection/websocket/environment-protocol-connection.contract";
import { Cause, Effect, Option, Queue, Schema } from "effect";

export type EnvironmentSocketEvent =
  | { readonly _tag: "Message"; readonly event: MessageEvent }
  | { readonly _tag: "Open" };

export function acquireEnvironmentSocket(socketUrl: URL, signal: AbortSignal) {
  return Effect.acquireRelease(
    Effect.try({
      try: () => new WebSocket(socketUrl),
      catch: () => environmentResponseError("WebSocket"),
    }),
    (socket) =>
      Effect.sync(() => {
        if (socket.readyState < WebSocket.CLOSING) {
          socket.close();
        }
      }),
  ).pipe(
    Effect.tap((socket) =>
      signal.aborted
        ? Effect.fail(environmentResponseError("WebSocket"))
        : Effect.succeed(socket),
    ),
  );
}

export function acquireEnvironmentSocketEvents(
  socket: WebSocket,
  signal: AbortSignal,
  discovery: EnvironmentDiscovery,
) {
  return Effect.gen(function* () {
    const events = yield* Queue.bounded<
      EnvironmentSocketEvent,
      EnvironmentConnectionFailure
    >(discovery.limits.maxQueuedEvents);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const fail = (error: EnvironmentConnectionFailure) => {
          Queue.failCauseUnsafe(events, Cause.fail(error));
        };
        const opened = () => {
          Queue.offerUnsafe(events, { _tag: "Open" });
        };
        const received = (event: MessageEvent) => {
          if (!Queue.offerUnsafe(events, { _tag: "Message", event })) {
            fail(environmentResponseError("WebSocket"));
            socket.close();
          }
        };
        const failed = () => fail(environmentResponseError("WebSocket"));
        const aborted = () => fail(environmentResponseError("WebSocket"));

        socket.addEventListener("open", opened);
        socket.addEventListener("message", received);
        socket.addEventListener("error", failed);
        socket.addEventListener("close", failed);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) {
          aborted();
        }
        return { aborted, failed, opened, received };
      }),
      ({ aborted, failed, opened, received }) =>
        Effect.sync(() => {
          socket.removeEventListener("open", opened);
          socket.removeEventListener("message", received);
          socket.removeEventListener("error", failed);
          socket.removeEventListener("close", failed);
          signal.removeEventListener("abort", aborted);
        }).pipe(Effect.andThen(Queue.shutdown(events))),
    );
    return events;
  });
}

export function readEnvironmentHelloResult(
  socket: WebSocket,
  events: Queue.Dequeue<EnvironmentSocketEvent, EnvironmentConnectionFailure>,
  hello: EnvironmentHello,
  discovery: EnvironmentDiscovery,
) {
  return Effect.gen(function* () {
    const received = yield* Effect.gen(function* () {
      const opened = yield* Queue.take(events);
      if (opened._tag !== "Open") {
        return yield* Effect.fail(environmentResponseError("WebSocket"));
      }
      yield* sendEnvironmentSocketMessage(
        socket,
        EnvironmentHelloSchema,
        hello,
      );
      const response = yield* Queue.take(events);
      if (response._tag !== "Message") {
        return yield* Effect.fail(environmentResponseError("WebSocket"));
      }
      return response.event;
    }).pipe(Effect.timeoutOption(discovery.limits.helloTimeoutMilliseconds));
    if (Option.isNone(received)) {
      return yield* Effect.fail(environmentResponseError("WebSocket"));
    }

    const parsed = yield* parseEnvironmentSocketMessage(
      received.value,
      hello.receiveLimits.maxWebSocketResponseBytes,
      EnvironmentHelloResult,
    );
    if (parsed._tag === "HelloRejected") {
      return yield* Effect.fail(
        new EnvironmentHelloRejected({ failure: parsed.failure }),
      );
    }
    if (!isNegotiatedResultValid(discovery, hello, parsed)) {
      return yield* Effect.fail(environmentResponseError("WebSocket"));
    }
    return parsed;
  });
}

export function decodeEnvironmentServerMessage(
  event: MessageEvent,
  hello: EnvironmentHello,
  negotiated: NegotiatedEnvironment,
) {
  return parseEnvironmentSocketMessage(
    event,
    Math.min(
      negotiated.limits.maxWebSocketResponseBytes,
      hello.receiveLimits.maxWebSocketResponseBytes,
    ),
    EnvironmentServerMessage,
  );
}

export function sendEnvironmentSocketMessage<
  S extends Schema.ConstraintEncoder<unknown, never>,
>(socket: WebSocket, schema: S, message: S["Type"]) {
  return Effect.try({
    try: () => socket.send(JSON.stringify(Schema.encodeSync(schema)(message))),
    catch: () => environmentResponseError("WebSocket"),
  });
}

function parseEnvironmentSocketMessage<
  S extends Schema.ConstraintDecoder<unknown, never>,
>(event: MessageEvent, byteLimit: number, schema: S) {
  return Effect.try({
    try: () => {
      if (
        typeof event.data !== "string" ||
        new TextEncoder().encode(event.data).byteLength > byteLimit
      ) {
        throw environmentResponseError("WebSocket");
      }
      return Schema.decodeUnknownSync(schema)(JSON.parse(event.data));
    },
    catch: () => environmentResponseError("WebSocket"),
  });
}

function isNegotiatedResultValid(
  discovery: EnvironmentDiscovery,
  hello: EnvironmentHello,
  result: NegotiatedEnvironment,
) {
  const expected = negotiateEnvironmentHello(
    discovery,
    hello,
    result.currentSequence,
  );
  return (
    expected._tag === "HelloAccepted" &&
    JSON.stringify(Schema.encodeSync(EnvironmentHelloResult)(expected)) ===
      JSON.stringify(Schema.encodeSync(EnvironmentHelloResult)(result))
  );
}
