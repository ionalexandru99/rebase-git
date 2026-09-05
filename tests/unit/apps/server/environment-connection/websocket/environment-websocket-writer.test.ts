import {
  createCurrentEnvironmentDiscovery,
  currentTransportLimits,
} from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { createEnvironmentWebSocketWriter } from "#server/features/environment-connection/websocket/environment-websocket-writer";

describe("Environment WebSocket writer", () => {
  it("keeps the latest snapshot target while the bounded queue is paused", async () => {
    const events = createEnvironmentEventPublisher();
    const state: EnvironmentTransportState = {
      discovery: createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      ),
      events,
    };
    const socket = new ControlledWebSocket();
    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* createEnvironmentWebSocketWriter(
          socket as unknown as Parameters<
            typeof createEnvironmentWebSocketWriter
          >[0],
          state,
        );
        yield* writer.setNegotiatedContract(
          { ...currentTransportLimits, maxQueuedEvents: 1 },
          true,
        );

        const first = yield* Effect.forkChild(
          writer.send(changed(events.publishChanged())),
        );
        yield* Effect.yieldNow;
        const second = yield* Effect.forkChild(
          writer.send(changed(events.publishChanged())),
        );
        yield* Effect.yieldNow;
        const third = yield* Effect.forkChild(
          writer.send(changed(events.publishChanged())),
        );
        yield* Effect.yieldNow;
        events.publishChanged();
        yield* writer.send(changed(4));

        socket.completeSend();
        yield* Effect.yieldNow;
        socket.completeSend();
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        yield* Fiber.join(third);
        expect(yield* writer.acknowledgeSnapshot(3)).toBe(false);

        const resnapshot = yield* Effect.forkChild(
          writer.send({
            _tag: "ResnapshotRequired",
            currentSequence: 4,
            reason: "OutgoingQueueOverflow",
          }),
        );
        yield* Effect.yieldNow;
        socket.completeSend();
        yield* Fiber.join(resnapshot);
        expect(yield* writer.acknowledgeSnapshot(4)).toBe(true);

        const changedAfterSnapshot = yield* Effect.forkChild(
          writer.send(changed(events.publishChanged())),
        );
        yield* Effect.yieldNow;
        expect(JSON.parse(socket.messages.at(-1) ?? "")).toEqual({
          _tag: "EnvironmentChanged",
          sequence: 5,
        });
        socket.completeSend();
        yield* Fiber.join(changedAfterSnapshot);
      }),
    );
  });

  it("fails when the queue overflows without resnapshot support", async () => {
    const { events, state } = createState();
    const socket = new ControlledWebSocket();
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* createEnvironmentWebSocketWriter(
          asWebSocket(socket),
          state,
        );
        yield* writer.setNegotiatedContract(
          { ...currentTransportLimits, maxQueuedEvents: 1 },
          false,
        );
        yield* Effect.forkChild(writer.send(changed(events.publishChanged())));
        yield* Effect.yieldNow;
        yield* Effect.forkChild(writer.send(changed(events.publishChanged())));
        yield* Effect.yieldNow;
        return yield* writer
          .send(changed(events.publishChanged()))
          .pipe(Effect.flip);
      }),
    );

    expect(error).toMatchObject({
      _tag: "EnvironmentWebSocketWriteError",
      closeCode: 1013,
      reason: "OutgoingQueueOverflow",
    });
  });

  it("maps a socket send failure to a typed write error", async () => {
    const { events, state } = createState();
    const socket = new ControlledWebSocket();
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* createEnvironmentWebSocketWriter(
          asWebSocket(socket),
          state,
        );
        const sending = yield* Effect.forkChild(
          writer.send(changed(events.publishChanged())),
        );
        yield* Effect.yieldNow;
        socket.completeSend(new Error("write failed"));
        return yield* Fiber.join(sending).pipe(Effect.flip);
      }),
    );

    expect(error).toMatchObject({
      _tag: "EnvironmentWebSocketWriteError",
      closeCode: 1011,
      reason: "WebSocketWriteFailed",
    });
  });

  it("rejects an outgoing message beyond the negotiated byte limit", async () => {
    const { events, state } = createState();
    const socket = new ControlledWebSocket();
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* createEnvironmentWebSocketWriter(
          asWebSocket(socket),
          state,
        );
        yield* writer.setNegotiatedContract(
          { ...currentTransportLimits, maxWebSocketResponseBytes: 1 },
          true,
        );
        return yield* writer
          .send(changed(events.publishChanged()))
          .pipe(Effect.flip);
      }),
    );

    expect(error).toMatchObject({
      _tag: "EnvironmentWebSocketWriteError",
      closeCode: 1009,
      reason: "PayloadTooLarge",
    });
    expect(socket.messages).toEqual([]);
  });

  it("fails rather than discarding a message when the socket is closed", async () => {
    const { events, state } = createState();
    const socket = new ControlledWebSocket();
    socket.readyState = 3;
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* createEnvironmentWebSocketWriter(
          asWebSocket(socket),
          state,
        );
        return yield* writer
          .send(changed(events.publishChanged()))
          .pipe(Effect.flip);
      }),
    );

    expect(error).toMatchObject({
      _tag: "EnvironmentWebSocketWriteError",
      closeCode: 1011,
      reason: "WebSocketNotOpen",
    });
  });
});

function createState() {
  const events = createEnvironmentEventPublisher();
  const state: EnvironmentTransportState = {
    discovery: createCurrentEnvironmentDiscovery(
      "00000000-0000-4000-8000-000000000001",
      "0.0.0",
    ),
    events,
  };
  return { events, state };
}

function asWebSocket(socket: ControlledWebSocket) {
  return socket as unknown as Parameters<
    typeof createEnvironmentWebSocketWriter
  >[0];
}

function changed(sequence: number) {
  return { _tag: "EnvironmentChanged" as const, sequence };
}

class ControlledWebSocket {
  readonly messages: string[] = [];
  readyState = 1;
  private readonly callbacks: Array<(error?: Error) => void> = [];

  close() {}

  send(message: string, callback: (error?: Error) => void) {
    this.messages.push(message);
    this.callbacks.push(callback);
  }

  completeSend(error?: Error) {
    const callback = this.callbacks.shift();
    if (callback === undefined) {
      throw new Error("No WebSocket send is pending.");
    }
    callback(error);
  }

  terminate() {}
}
