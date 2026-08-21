import {
  type EnvironmentServerMessage,
  EnvironmentServerMessage as EnvironmentServerMessageSchema,
  type TransportLimits,
} from "@rebase/contracts";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-connection.contract";
import {
  createOutgoingMessageQueue,
  dequeueOutgoingMessage,
  enqueueOutgoingMessage,
  replaceWithResnapshotMessage,
  resetOutgoingMessageQueue,
} from "@rebase/server/features/environment-connection/websocket/outgoing-message-queue";
import { Schema } from "effect";
import { WebSocket } from "ws";

export function createEnvironmentWebSocketWriter(
  socket: WebSocket,
  state: EnvironmentTransportState,
) {
  let queue = createOutgoingMessageQueue();
  let limits = state.discovery.limits;
  let requiredSnapshotSequence: number | undefined;
  let sending = false;
  let supportsResnapshot = false;

  const send = (message: EnvironmentServerMessage) => {
    if (
      message._tag === "EnvironmentChanged" &&
      requiredSnapshotSequence !== undefined
    ) {
      requiredSnapshotSequence = Math.max(
        requiredSnapshotSequence,
        message.sequence,
      );
      return;
    }

    const encoded = JSON.stringify(
      Schema.encodeSync(EnvironmentServerMessageSchema)(message),
    );
    if (Buffer.byteLength(encoded) > limits.maxWebSocketResponseBytes) {
      socket.close(1009, "PayloadTooLarge");
      return;
    }

    if (message._tag === "ResnapshotRequired") {
      requiredSnapshotSequence = message.currentSequence;
      if (queue.overflowed) {
        queue = replaceWithResnapshotMessage(queue, encoded);
        drain();
        return;
      }
    }

    const overflowSequence = state.events.currentSequence();
    const overflow = encodeMessage({
      _tag: "ResnapshotRequired" as const,
      currentSequence: overflowSequence,
      reason: "OutgoingQueueOverflow" as const,
    });
    const wasOverflowed = queue.overflowed;
    queue = enqueueOutgoingMessage(queue, encoded, overflow, limits);
    if (!wasOverflowed && queue.overflowed) {
      if (!supportsResnapshot) {
        socket.close(1013, "OutgoingQueueOverflow");
        return;
      }
      requiredSnapshotSequence = overflowSequence;
    }
    drain();
  };

  const drain = () => {
    if (sending || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const next = dequeueOutgoingMessage(queue);
    queue = next.queue;
    if (next.message === undefined) {
      return;
    }

    sending = true;
    socket.send(next.message, (error) => {
      sending = false;
      if (error) {
        socket.terminate();
        return;
      }
      drain();
    });
  };

  const acknowledgeSnapshot = (sequence: number) => {
    if (
      requiredSnapshotSequence !== sequence ||
      sequence !== state.events.currentSequence() ||
      sending ||
      queue.messages.length > 0
    ) {
      return false;
    }

    queue = resetOutgoingMessageQueue();
    requiredSnapshotSequence = undefined;
    return true;
  };

  const setNegotiatedContract = (
    negotiatedLimits: TransportLimits,
    negotiatedSupportsResnapshot: boolean,
  ) => {
    limits = negotiatedLimits;
    supportsResnapshot = negotiatedSupportsResnapshot;
  };

  return { acknowledgeSnapshot, send, setNegotiatedContract };
}

function encodeMessage(message: EnvironmentServerMessage) {
  return JSON.stringify(
    Schema.encodeSync(EnvironmentServerMessageSchema)(message),
  );
}
