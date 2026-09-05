import { EventEmitter } from "node:events";
import {
  createCurrentEnvironmentDiscovery,
  createCurrentEnvironmentHello,
  EnvironmentHelloResult,
  EnvironmentServerMessage,
} from "@rebase/contracts";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { runEnvironmentWebSocketSession } from "#server/features/environment-connection/websocket/environment-websocket-session";

describe("Environment WebSocket session", () => {
  it("rejects a client that misses the hello deadline", async () => {
    const socket = new ControlledWebSocket();
    const state: EnvironmentTransportState = {
      discovery: createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      ),
      events: createEnvironmentEventPublisher(),
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* runEnvironmentWebSocketSession(
          asWebSocket(socket),
          state,
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(
          state.discovery.limits.helloTimeoutMilliseconds,
        );
        socket.completeSend();
        yield* Fiber.join(session);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(
      Schema.decodeUnknownSync(EnvironmentHelloResult)(
        JSON.parse(socket.messages[0] ?? ""),
      ),
    ).toEqual({
      _tag: "HelloRejected",
      failure: { _tag: "HandshakeRequired" },
    });
    expect(socket.closedWith).toEqual({
      code: 1008,
      reason: "HandshakeRequired",
    });
  });

  it("queues events published while the hello response is in flight", async () => {
    const socket = new ControlledWebSocket();
    const events = createEnvironmentEventPublisher();
    const state: EnvironmentTransportState = {
      discovery: createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      ),
      events,
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* runEnvironmentWebSocketSession(
          asWebSocket(socket),
          state,
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        socket.receive(JSON.stringify(createCurrentEnvironmentHello("0.0.0")));
        yield* Effect.yieldNow;
        expect(socket.messages).toHaveLength(1);

        events.publishChanged();
        socket.completeSend();
        yield* Effect.yieldNow;
        expect(
          Schema.decodeUnknownSync(EnvironmentServerMessage)(
            JSON.parse(socket.messages[1] ?? ""),
          ),
        ).toEqual({ _tag: "EnvironmentChanged", sequence: 1 });

        socket.completeSend();
        socket.disconnect();
        yield* Fiber.join(session);
        events.publishChanged();
        expect(socket.messages).toHaveLength(2);
      }),
    );
  });
});

function asWebSocket(socket: ControlledWebSocket) {
  return socket as unknown as Parameters<
    typeof runEnvironmentWebSocketSession
  >[0];
}

class ControlledWebSocket extends EventEmitter {
  readonly messages: string[] = [];
  readyState = 1;
  closedWith: { readonly code: number; readonly reason: string } | undefined;
  private readonly callbacks: Array<(error?: Error) => void> = [];

  close(code: number, reason: string) {
    this.closedWith = { code, reason };
    this.disconnect();
  }

  completeSend() {
    const callback = this.callbacks.shift();
    if (callback === undefined) {
      throw new Error("No WebSocket send is pending.");
    }
    callback();
  }

  disconnect() {
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: string) {
    this.emit("message", Buffer.from(message), false);
  }

  send(message: string, callback: (error?: Error) => void) {
    this.messages.push(message);
    this.callbacks.push(callback);
  }

  terminate() {}
}
