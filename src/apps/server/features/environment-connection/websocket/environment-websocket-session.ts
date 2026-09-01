import {
  type EnvironmentAccessCapability,
  EnvironmentClientMessage,
  type EnvironmentHello,
  EnvironmentHelloResult,
  type EnvironmentTransportFailure,
  encodeRepositoryHistoryPage,
  type HelloAccepted,
  negotiateEnvironmentHello,
} from "@rebase/contracts";
import { Effect, FiberSet, Option, Queue, Schema } from "effect";
import type { WebSocket } from "ws";
import { WebSocket as WebSocketState } from "ws";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import {
  type EnvironmentWebSocketSessionClosed,
  EnvironmentWebSocketSessionRejected,
  type EnvironmentWebSocketWriteError,
} from "#server/features/environment-connection/websocket/environment-websocket-error.contract";
import {
  acquireEnvironmentWebSocketInbox,
  type EnvironmentSocketMessage,
} from "#server/features/environment-connection/websocket/environment-websocket-inbox";
import {
  createEnvironmentWebSocketWriter,
  type EnvironmentWebSocketWriter,
} from "#server/features/environment-connection/websocket/environment-websocket-writer";

export function runEnvironmentWebSocketSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
  accessCapabilities: ReadonlySet<EnvironmentAccessCapability> = new Set([
    "repository.read",
  ]),
) {
  return runSession(socket, state, accessCapabilities).pipe(
    Effect.catchTag("EnvironmentWebSocketSessionClosed", () => Effect.void),
    Effect.catchTag("EnvironmentWebSocketSessionRejected", ({ result }) =>
      rejectAndClose(socket, result),
    ),
    Effect.catchTag("EnvironmentWebSocketWriteError", (error) =>
      closeForWriteError(socket, error),
    ),
    Effect.scoped,
  );
}

function runSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
  accessCapabilities: ReadonlySet<EnvironmentAccessCapability>,
) {
  return Effect.gen(function* () {
    const messages = yield* acquireEnvironmentWebSocketInbox(socket, state);
    const writer = yield* createEnvironmentWebSocketWriter(socket, state);
    const runSessionEffect = yield* FiberSet.makeRuntime<never, void, never>();
    const historyRequests = new Map<string, AbortController>();
    let logicalMessageId = 0;
    const hello = yield* readHello(messages, state);
    const result = yield* negotiateSession(state, hello);
    const capabilities = yield* initializeNegotiatedSession(
      socket,
      state,
      runSessionEffect,
      writer,
      hello,
      result,
    );
    yield* processClientMessages(
      messages,
      writer,
      state,
      capabilities,
      accessCapabilities,
      historyRequests,
      runSessionEffect,
      () => {
        logicalMessageId += 1;
        return logicalMessageId;
      },
    );
  });
}

function negotiateSession(
  state: EnvironmentTransportState,
  hello: EnvironmentHello,
) {
  const result = negotiateEnvironmentHello(
    state.discovery,
    hello,
    state.events.currentSequence(),
  );
  return result._tag === "HelloRejected"
    ? Effect.fail(new EnvironmentWebSocketSessionRejected({ result }))
    : Effect.succeed(result);
}

function initializeNegotiatedSession(
  socket: WebSocket,
  state: EnvironmentTransportState,
  runSessionEffect: (
    effect: Effect.Effect<void, never, never>,
    options?: Effect.RunOptions,
  ) => unknown,
  writer: EnvironmentWebSocketWriter,
  hello: EnvironmentHello,
  result: HelloAccepted,
) {
  return Effect.gen(function* () {
    const capabilities = new Set(
      result.capabilities.map((capability) => capability.name),
    );
    const supportsEnvironmentEvents = capabilities.has("environment-events");
    const supportsResnapshot = capabilities.has("sequence-resnapshot");
    yield* writer.setNegotiatedContract(result.limits, supportsResnapshot);
    yield* writer.enqueue(result);
    if (supportsEnvironmentEvents) {
      yield* acquireEventSubscription(
        socket,
        state,
        runSessionEffect,
        writer.send,
      );
    }
    yield* enqueueInitialResnapshot(writer.enqueue, hello, result, state);
    yield* writer.flush;
    return capabilities;
  });
}

function processClientMessages(
  messages: Queue.Dequeue<
    EnvironmentSocketMessage,
    EnvironmentWebSocketSessionClosed
  >,
  writer: EnvironmentWebSocketWriter,
  state: EnvironmentTransportState,
  capabilities: ReadonlySet<string>,
  accessCapabilities: ReadonlySet<EnvironmentAccessCapability>,
  historyRequests: Map<string, AbortController>,
  runSessionEffect: (
    effect: Effect.Effect<void, never, never>,
    options?: Effect.RunOptions,
  ) => unknown,
  nextLogicalMessageId: () => number,
) {
  return Effect.gen(function* () {
    while (true) {
      const message = decodeSocketMessage(yield* Queue.take(messages));
      yield* handleClientMessage(
        message,
        writer,
        state,
        capabilities,
        accessCapabilities,
        historyRequests,
        runSessionEffect,
        nextLogicalMessageId,
      );
    }
  });
}

function handleClientMessage(
  message: typeof EnvironmentClientMessage.Type | undefined,
  writer: EnvironmentWebSocketWriter,
  state: EnvironmentTransportState,
  capabilities: ReadonlySet<string>,
  accessCapabilities: ReadonlySet<EnvironmentAccessCapability>,
  historyRequests: Map<string, AbortController>,
  runSessionEffect: (
    effect: Effect.Effect<void, never, never>,
    options?: Effect.RunOptions,
  ) => unknown,
  nextLogicalMessageId: () => number,
) {
  if (message === undefined) {
    return rejectSession("InvalidMessage");
  }
  if (message._tag === "Hello") {
    return rejectSession("HandshakeAlreadyCompleted");
  }
  switch (message._tag) {
    case "SnapshotApplied":
      if (!capabilities.has("sequence-resnapshot")) {
        return rejectSession("InvalidMessage");
      }
      return Effect.gen(function* () {
        if (!(yield* writer.acknowledgeSnapshot(message.sequence))) {
          yield* writer.send({
            _tag: "ResnapshotRequired",
            currentSequence: state.events.currentSequence(),
            reason: "SequenceGap",
          });
        }
      });
    case "ReadRepositoryHistory": {
      const history = state.history;
      if (
        !capabilities.has("repository-history") ||
        !capabilities.has("binary-fragmentation") ||
        history === undefined ||
        historyRequests.has(message.requestId)
      ) {
        return rejectSession("InvalidMessage");
      }
      if (!accessCapabilities.has("repository.read")) {
        return writer.send({
          _tag: "RepositoryHistoryFailed",
          failure: { _tag: "AuthorizationDenied" },
          requestId: message.requestId,
        });
      }
      return Effect.sync(() => {
        const controller = new AbortController();
        historyRequests.set(message.requestId, controller);
        runSessionEffect(
          history.read(message).pipe(
            Effect.flatMap((page) =>
              writer.sendBinary({
                logicalMessageId: nextLogicalMessageId(),
                payload: encodeRepositoryHistoryPage(page),
                requestId: message.requestId,
              }),
            ),
            Effect.catch((error) =>
              writer.send({
                _tag: "RepositoryHistoryFailed",
                failure:
                  error._tag === "RepositoryHistoryError"
                    ? error.failure
                    : { _tag: "GitFailed", reason: "Failed" },
                requestId: message.requestId,
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => historyRequests.delete(message.requestId)),
            ),
            Effect.catchTag(
              "EnvironmentWebSocketWriteError",
              () => Effect.void,
            ),
          ),
          { signal: controller.signal },
        );
        if (controller.signal.aborted)
          historyRequests.delete(message.requestId);
      });
    }
    case "CancelRepositoryHistory":
      return Effect.sync(() => {
        historyRequests.get(message.requestId)?.abort();
        historyRequests.delete(message.requestId);
      });
  }
}

function readHello(
  messages: Queue.Dequeue<
    EnvironmentSocketMessage,
    EnvironmentWebSocketSessionClosed
  >,
  state: EnvironmentTransportState,
) {
  return Effect.gen(function* () {
    const first = yield* Queue.take(messages).pipe(
      Effect.timeoutOption(state.discovery.limits.helloTimeoutMilliseconds),
    );
    if (Option.isNone(first)) {
      return yield* rejectSession("HandshakeRequired");
    }

    const message = decodeSocketMessage(first.value);
    if (message === undefined) {
      return yield* rejectSession("InvalidMessage");
    }
    if (message._tag !== "Hello") {
      return yield* rejectSession("HandshakeRequired");
    }
    return message;
  });
}

function acquireEventSubscription(
  socket: WebSocket,
  state: EnvironmentTransportState,
  runSessionEffect: (effect: Effect.Effect<void, never, never>) => unknown,
  send: EnvironmentWebSocketWriter["send"],
) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      state.events.subscribe((sequence) => {
        runSessionEffect(
          send({ _tag: "EnvironmentChanged", sequence }).pipe(
            Effect.catchTag("EnvironmentWebSocketWriteError", (error) =>
              closeForWriteError(socket, error),
            ),
          ),
        );
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
}

function enqueueInitialResnapshot(
  enqueue: EnvironmentWebSocketWriter["enqueue"],
  hello: EnvironmentHello,
  result: HelloAccepted,
  state: EnvironmentTransportState,
) {
  if (
    !result.capabilities.some(
      (capability) => capability.name === "sequence-resnapshot",
    ) ||
    (hello.lastObservedSequence === undefined
      ? result.currentSequence === state.events.currentSequence()
      : hello.lastObservedSequence === result.currentSequence &&
        result.currentSequence === state.events.currentSequence())
  ) {
    return Effect.void;
  }

  return enqueue({
    _tag: "ResnapshotRequired",
    currentSequence: state.events.currentSequence(),
    reason: "SequenceGap",
  });
}

function decodeSocketMessage(message: EnvironmentSocketMessage) {
  if (message.isBinary) {
    return undefined;
  }

  try {
    return Schema.decodeUnknownSync(EnvironmentClientMessage)(
      JSON.parse(message.data.toString()),
      { onExcessProperty: "error" },
    );
  } catch {
    return undefined;
  }
}

function rejectSession(
  failure: "HandshakeAlreadyCompleted" | "HandshakeRequired" | "InvalidMessage",
) {
  return Effect.fail(
    new EnvironmentWebSocketSessionRejected({
      result: { _tag: "HelloRejected", failure: sessionFailure(failure) },
    }),
  );
}

function sessionFailure(
  failure: "HandshakeAlreadyCompleted" | "HandshakeRequired" | "InvalidMessage",
): EnvironmentTransportFailure {
  switch (failure) {
    case "HandshakeAlreadyCompleted":
      return { _tag: "HandshakeAlreadyCompleted" };
    case "HandshakeRequired":
      return { _tag: "HandshakeRequired" };
    case "InvalidMessage":
      return { _tag: "InvalidMessage" };
  }
}

function rejectAndClose(
  socket: WebSocket,
  result: typeof EnvironmentHelloResult.Type,
) {
  if (result._tag !== "HelloRejected") {
    return Effect.void;
  }

  const encoded = JSON.stringify(
    Schema.encodeSync(EnvironmentHelloResult)(result),
  );
  return Effect.callback<void>((resume) => {
    if (socket.readyState !== WebSocketState.OPEN) {
      socket.terminate();
      resume(Effect.void);
      return;
    }

    socket.send(encoded, (error) => {
      if (error != null) {
        socket.terminate();
      } else {
        socket.close(1008, result.failure._tag);
      }
      resume(Effect.void);
    });
  });
}

function closeForWriteError(
  socket: WebSocket,
  error: EnvironmentWebSocketWriteError,
) {
  return Effect.sync(() => {
    if (socket.readyState === WebSocketState.OPEN) {
      socket.close(error.closeCode, error.reason);
    } else {
      socket.terminate();
    }
  });
}
