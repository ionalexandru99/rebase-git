import {
  type BinaryLogicalMessage,
  type EnvironmentServerMessage,
  EnvironmentServerMessage as EnvironmentServerMessageSchema,
  fragmentBinaryMessage,
  type TransportLimits,
} from "@rebase/contracts";
import { Effect, Ref, Schema, Semaphore } from "effect";
import { WebSocket } from "ws";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import { EnvironmentWebSocketWriteError } from "#server/features/environment-connection/websocket/environment-websocket-error.contract";
import {
  createOutgoingMessageQueue,
  dequeueOutgoingMessage,
  enqueueOutgoingMessage,
  type OutgoingMessageQueue,
  replaceWithResnapshotMessage,
  resetOutgoingMessageQueue,
} from "#server/features/environment-connection/websocket/outgoing-message-queue";

export interface EnvironmentWebSocketWriter {
  readonly acknowledgeSnapshot: (
    sequence: number,
  ) => Effect.Effect<boolean, EnvironmentWebSocketWriteError>;
  readonly send: (
    message: EnvironmentServerMessage,
  ) => Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly sendBinary: (
    message: BinaryLogicalMessage,
  ) => Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly enqueue: (
    message: EnvironmentServerMessage,
  ) => Effect.Effect<boolean, EnvironmentWebSocketWriteError>;
  readonly flush: Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly setNegotiatedContract: (
    negotiatedLimits: TransportLimits,
    negotiatedSupportsResnapshot: boolean,
  ) => Effect.Effect<void>;
}

interface WriterState {
  readonly limits: TransportLimits;
  readonly queue: OutgoingMessageQueue;
  readonly requiredSnapshotSequence: number | undefined;
  readonly supportsResnapshot: boolean;
}

type EnqueueResult =
  | { readonly _tag: "Enqueued" }
  | { readonly _tag: "Ignored" }
  | {
      readonly _tag: "Rejected";
      readonly error: EnvironmentWebSocketWriteError;
    };

export function createEnvironmentWebSocketWriter(
  socket: WebSocket,
  state: EnvironmentTransportState,
) {
  return Effect.gen(function* () {
    const writerState = yield* Ref.make<WriterState>({
      limits: state.discovery.limits,
      queue: createOutgoingMessageQueue(),
      requiredSnapshotSequence: undefined,
      supportsResnapshot: false,
    });
    const sendPermit = yield* Semaphore.make(1);
    const flush = flushOutgoingMessages(socket, writerState, sendPermit);
    const enqueue = (message: EnvironmentServerMessage) =>
      enqueueServerMessage(writerState, state, message);
    const send = (message: EnvironmentServerMessage) =>
      sendServerMessage(enqueue, flush, message);

    return {
      acknowledgeSnapshot: (sequence) =>
        acknowledgeSnapshot(writerState, state, sendPermit, sequence),
      enqueue,
      flush,
      send,
      sendBinary: (message) =>
        sendBinaryMessage(socket, writerState, sendPermit, message),
      setNegotiatedContract: (limits, supportsResnapshot) =>
        setNegotiatedContract(writerState, limits, supportsResnapshot),
    } satisfies EnvironmentWebSocketWriter;
  });
}

function sendBinaryMessage(
  socket: WebSocket,
  writerState: Ref.Ref<WriterState>,
  sendPermit: Semaphore.Semaphore,
  message: BinaryLogicalMessage,
) {
  return sendPermit.withPermit(
    Effect.gen(function* () {
      const { limits } = yield* Ref.get(writerState);
      const frames = fragmentBinaryMessage(
        message,
        limits.maxWebSocketResponseBytes,
      );
      for (const frame of frames) yield* sendWebSocketBinary(socket, frame);
    }),
  );
}

function flushOutgoingMessages(
  socket: WebSocket,
  writerState: Ref.Ref<WriterState>,
  sendPermit: Semaphore.Semaphore,
) {
  return sendPermit.withPermit(
    Effect.gen(function* () {
      while (true) {
        if (socket.readyState !== WebSocket.OPEN) {
          return yield* Effect.fail(
            new EnvironmentWebSocketWriteError({
              closeCode: 1011,
              reason: "WebSocketNotOpen",
            }),
          );
        }
        const next = yield* dequeueServerMessage(writerState);
        if (next === undefined) {
          return;
        }

        yield* sendWebSocketMessage(socket, next);
      }
    }),
  );
}

function dequeueServerMessage(writerState: Ref.Ref<WriterState>) {
  return Ref.modify(writerState, (current) => {
    const dequeued = dequeueOutgoingMessage(current.queue);
    return [dequeued.message, { ...current, queue: dequeued.queue }];
  });
}

function enqueueServerMessage(
  writerState: Ref.Ref<WriterState>,
  transportState: EnvironmentTransportState,
  message: EnvironmentServerMessage,
) {
  return Effect.gen(function* () {
    const result = yield* Ref.modify(writerState, (current) =>
      enqueueMessage(current, message, transportState.events.currentSequence()),
    );
    if (result._tag === "Rejected") {
      return yield* result.error;
    }
    return result._tag === "Enqueued";
  });
}

function sendServerMessage(
  enqueue: EnvironmentWebSocketWriter["enqueue"],
  flush: EnvironmentWebSocketWriter["flush"],
  message: EnvironmentServerMessage,
) {
  return Effect.gen(function* () {
    if (yield* enqueue(message)) {
      yield* flush;
    }
  });
}

function acknowledgeSnapshot(
  writerState: Ref.Ref<WriterState>,
  transportState: EnvironmentTransportState,
  sendPermit: Semaphore.Semaphore,
  sequence: number,
) {
  return sendPermit.withPermit(
    Ref.modify(writerState, (current) => {
      if (
        current.requiredSnapshotSequence !== sequence ||
        sequence !== transportState.events.currentSequence() ||
        current.queue.messages.length > 0
      ) {
        return [false, current];
      }

      return [
        true,
        {
          ...current,
          queue: resetOutgoingMessageQueue(),
          requiredSnapshotSequence: undefined,
        },
      ];
    }),
  );
}

function setNegotiatedContract(
  writerState: Ref.Ref<WriterState>,
  limits: TransportLimits,
  supportsResnapshot: boolean,
) {
  return Ref.update(writerState, (current) => ({
    ...current,
    limits,
    supportsResnapshot,
  }));
}

function enqueueMessage(
  state: WriterState,
  message: EnvironmentServerMessage,
  currentSequence: number,
): readonly [EnqueueResult, WriterState] {
  if (
    message._tag === "EnvironmentChanged" &&
    state.requiredSnapshotSequence !== undefined
  ) {
    return [
      { _tag: "Ignored" },
      {
        ...state,
        requiredSnapshotSequence: Math.max(
          state.requiredSnapshotSequence,
          message.sequence,
        ),
      },
    ];
  }

  const encoded = encodeMessage(message);
  if (Buffer.byteLength(encoded) > state.limits.maxWebSocketResponseBytes) {
    return [
      {
        _tag: "Rejected",
        error: new EnvironmentWebSocketWriteError({
          closeCode: 1009,
          reason: "PayloadTooLarge",
        }),
      },
      state,
    ];
  }

  if (message._tag === "ResnapshotRequired" && state.queue.overflowed) {
    return [
      { _tag: "Enqueued" },
      {
        ...state,
        queue: replaceWithResnapshotMessage(state.queue, encoded),
        requiredSnapshotSequence: message.currentSequence,
      },
    ];
  }

  const overflow = encodeMessage({
    _tag: "ResnapshotRequired",
    currentSequence,
    reason: "OutgoingQueueOverflow",
  });
  const queue = enqueueOutgoingMessage(
    state.queue,
    encoded,
    overflow,
    state.limits,
  );
  const overflowed = !state.queue.overflowed && queue.overflowed;
  if (overflowed && !state.supportsResnapshot) {
    return [
      {
        _tag: "Rejected",
        error: new EnvironmentWebSocketWriteError({
          closeCode: 1013,
          reason: "OutgoingQueueOverflow",
        }),
      },
      { ...state, queue },
    ];
  }

  return [
    { _tag: "Enqueued" },
    {
      ...state,
      queue,
      requiredSnapshotSequence:
        message._tag === "ResnapshotRequired"
          ? message.currentSequence
          : overflowed
            ? currentSequence
            : state.requiredSnapshotSequence,
    },
  ];
}

function sendWebSocketMessage(socket: WebSocket, message: string) {
  return Effect.callback<void, EnvironmentWebSocketWriteError>((resume) => {
    socket.send(message, (error) => {
      resume(
        error == null
          ? Effect.void
          : Effect.fail(
              new EnvironmentWebSocketWriteError({
                closeCode: 1011,
                reason: "WebSocketWriteFailed",
              }),
            ),
      );
    });
  });
}

function sendWebSocketBinary(socket: WebSocket, message: Uint8Array) {
  return Effect.callback<void, EnvironmentWebSocketWriteError>((resume) => {
    if (socket.readyState !== WebSocket.OPEN) {
      resume(
        Effect.fail(
          new EnvironmentWebSocketWriteError({
            closeCode: 1011,
            reason: "WebSocketNotOpen",
          }),
        ),
      );
      return;
    }
    socket.send(message, { binary: true }, (error) => {
      resume(
        error == null
          ? Effect.void
          : Effect.fail(
              new EnvironmentWebSocketWriteError({
                closeCode: 1011,
                reason: "WebSocketWriteFailed",
              }),
            ),
      );
    });
  });
}

function encodeMessage(message: EnvironmentServerMessage) {
  return JSON.stringify(
    Schema.encodeSync(EnvironmentServerMessageSchema)(message),
  );
}
