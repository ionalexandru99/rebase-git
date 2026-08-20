import {
  createOutgoingMessageQueue,
  dequeueOutgoingMessage,
  enqueueOutgoingMessage,
  resetOutgoingMessageQueue,
} from "@rebase/server/features/environment-connection/outgoing-message-queue";
import { describe, expect, it } from "vite-plus/test";

describe("outgoing Environment messages", () => {
  it("replaces an overflowing queue with one resnapshot response", () => {
    const limits = { maxQueuedEventBytes: 100, maxQueuedEvents: 2 };
    const overflowMessage = JSON.stringify({
      _tag: "ResnapshotRequired",
      currentSequence: 8,
      reason: "OutgoingQueueOverflow",
    });
    let queue = createOutgoingMessageQueue();
    queue = enqueueOutgoingMessage(queue, "first", overflowMessage, limits);
    queue = enqueueOutgoingMessage(queue, "second", overflowMessage, limits);
    queue = enqueueOutgoingMessage(queue, "third", overflowMessage, limits);
    queue = enqueueOutgoingMessage(queue, "fourth", overflowMessage, limits);

    expect(queue).toMatchObject({ overflowed: true });
    expect(queue.messages.map((message) => message.value)).toEqual([
      overflowMessage,
    ]);

    const drained = dequeueOutgoingMessage(queue);
    expect(drained.message).toBe(overflowMessage);
    expect(drained.queue.messages).toEqual([]);
    expect(resetOutgoingMessageQueue()).toEqual({
      messages: [],
      overflowed: false,
      queuedBytes: 0,
    });
  });

  it("counts UTF-8 bytes at and beyond the queue boundary", () => {
    const overflowMessage = "resnapshot";
    const limits = { maxQueuedEventBytes: 4, maxQueuedEvents: 10 };
    const exact = enqueueOutgoingMessage(
      createOutgoingMessageQueue(),
      "éé",
      overflowMessage,
      limits,
    );
    expect(exact).toMatchObject({ overflowed: false, queuedBytes: 4 });

    const exceeded = enqueueOutgoingMessage(
      exact,
      "x",
      overflowMessage,
      limits,
    );
    expect(exceeded).toMatchObject({
      overflowed: true,
      queuedBytes: Buffer.byteLength(overflowMessage),
    });
  });
});
