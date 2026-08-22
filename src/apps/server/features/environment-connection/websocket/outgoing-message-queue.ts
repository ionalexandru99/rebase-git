export interface OutgoingMessageQueue {
  readonly messages: ReadonlyArray<QueuedMessage>;
  readonly queuedBytes: number;
  readonly overflowed: boolean;
}

interface QueuedMessage {
  readonly byteLength: number;
  readonly value: string;
}

interface OutgoingMessageLimits {
  readonly maxQueuedEventBytes: number;
  readonly maxQueuedEvents: number;
}

export function createOutgoingMessageQueue(): OutgoingMessageQueue {
  return { messages: [], overflowed: false, queuedBytes: 0 };
}

export function enqueueOutgoingMessage(
  queue: OutgoingMessageQueue,
  value: string,
  overflowMessage: string,
  limits: OutgoingMessageLimits,
): OutgoingMessageQueue {
  if (queue.overflowed) {
    return queue;
  }

  const message = queuedMessage(value);
  const overCount = queue.messages.length + 1 > limits.maxQueuedEvents;
  const overBytes =
    queue.queuedBytes + message.byteLength > limits.maxQueuedEventBytes;
  if (overCount || overBytes) {
    const overflow = queuedMessage(overflowMessage);
    return {
      messages: [overflow],
      overflowed: true,
      queuedBytes: overflow.byteLength,
    };
  }

  return {
    messages: [...queue.messages, message],
    overflowed: false,
    queuedBytes: queue.queuedBytes + message.byteLength,
  };
}

export function dequeueOutgoingMessage(queue: OutgoingMessageQueue) {
  const [message, ...remaining] = queue.messages;
  if (message === undefined) {
    return { message: undefined, queue };
  }

  return {
    message: message.value,
    queue: {
      messages: remaining,
      overflowed: queue.overflowed,
      queuedBytes: queue.queuedBytes - message.byteLength,
    } satisfies OutgoingMessageQueue,
  };
}

export function resetOutgoingMessageQueue(): OutgoingMessageQueue {
  return createOutgoingMessageQueue();
}

export function replaceWithResnapshotMessage(
  queue: OutgoingMessageQueue,
  value: string,
): OutgoingMessageQueue {
  const message = queuedMessage(value);
  return {
    messages: [message],
    overflowed: queue.overflowed,
    queuedBytes: message.byteLength,
  };
}

function queuedMessage(value: string): QueuedMessage {
  return { byteLength: Buffer.byteLength(value), value };
}
