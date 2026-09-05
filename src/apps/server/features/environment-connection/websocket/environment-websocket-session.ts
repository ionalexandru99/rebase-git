import {
  type EnvironmentAccessCapability,
  EnvironmentClientMessage,
  type EnvironmentHello,
  EnvironmentHelloResult,
  type EnvironmentTransportFailure,
  type HelloAccepted,
  negotiateEnvironmentHello,
  type RepositoryFreshnessClientMessage,
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
import { createEnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer";
import type { EnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer.contract";
import { acquireRepositoryFreshnessSession } from "#server/features/environment-connection/websocket/repository-freshness-session";
import { acquireRepositoryHistorySession } from "#server/features/environment-connection/websocket/repository-history-session";
import type { RepositoryHistorySession } from "#server/features/environment-connection/websocket/repository-history-session.contract";

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
    const hello = yield* readHello(messages, state);
    const result = yield* negotiateSession(state, hello);
    const capabilities = yield* initializeNegotiatedSession(
      socket,
      state,
      runSessionEffect,
      writer,
      hello,
      { ...result, accessCapabilities: [...accessCapabilities] },
    );
    yield* processClientMessages(
      messages,
      writer,
      state,
      capabilities,
      yield* acquireRepositoryHistorySession(
        state.history,
        writer,
        accessCapabilities,
      ),
      yield* acquireRepositoryFreshnessSession(
        state.freshness,
        writer,
        capabilities,
        accessCapabilities,
        runSessionEffect,
      ),
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
    const capabilities = new Map(
      result.capabilities.map((capability) => [
        capability.name,
        capability.version,
      ]),
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
        capabilities.has("repository-ref-events"),
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
  capabilities: ReadonlyMap<string, number>,
  history: RepositoryHistorySession,
  handleFreshness: (
    message: RepositoryFreshnessClientMessage,
  ) => Effect.Effect<void, EnvironmentWebSocketWriteError>,
) {
  return Effect.gen(function* () {
    while (true) {
      const message = decodeSocketMessage(yield* Queue.take(messages));
      if (
        message?._tag === "SubscribeRepositoryHistory" ||
        message?._tag === "UnsubscribeRepositoryHistory" ||
        message?._tag === "FetchRepositoryHistory" ||
        message?._tag === "ConfigureRepositoryFetch"
      ) {
        yield* handleFreshness(message);
        continue;
      }
      yield* handleClientMessage(message, writer, state, capabilities, history);
    }
  });
}

function handleClientMessage(
  message:
    | Exclude<
        typeof EnvironmentClientMessage.Type,
        RepositoryFreshnessClientMessage
      >
    | undefined,
  writer: EnvironmentWebSocketWriter,
  state: EnvironmentTransportState,
  capabilities: ReadonlyMap<string, number>,
  history: RepositoryHistorySession,
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
    case "ReadRepositoryHistory":
    case "SynchronizeRepositoryHistory":
      if (
        (capabilities.get("repository-history") ?? 0) < 5 ||
        !capabilities.has("binary-fragmentation")
      ) {
        return rejectSession("InvalidMessage");
      }
      return history.handle(message);
    case "AcknowledgeRepositoryHistoryBatch":
    case "CancelRepositoryHistory":
      return history.handle(message);
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
  supportsRepositoryIdentity: boolean,
) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      state.events.subscribe((sequence, repositoryIds) => {
        runSessionEffect(
          send({
            _tag: "EnvironmentChanged",
            sequence,
            ...(supportsRepositoryIdentity && repositoryIds !== undefined
              ? { repositoryIds }
              : {}),
          }).pipe(
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
