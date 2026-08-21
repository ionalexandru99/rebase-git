import {
  createCurrentEnvironmentDiscovery,
  currentTransportLimits,
} from "@rebase/contracts";
import type { EnvironmentTransportState } from "@rebase/server/features/environment-connection/environment-connection.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { createEnvironmentWebSocketWriter } from "@rebase/server/features/environment-connection/websocket/environment-websocket-writer";
import { describe, expect, it } from "vite-plus/test";

describe("Environment WebSocket writer", () => {
  it("keeps the latest snapshot target while the bounded queue is paused", () => {
    const events = createEnvironmentEventPublisher();
    const state: EnvironmentTransportState = {
      discovery: createCurrentEnvironmentDiscovery(
        "00000000-0000-4000-8000-000000000001",
        "0.0.0",
      ),
      events,
    };
    const socket = new ControlledWebSocket();
    const writer = createEnvironmentWebSocketWriter(
      socket as unknown as Parameters<
        typeof createEnvironmentWebSocketWriter
      >[0],
      state,
    );
    writer.setNegotiatedContract(
      { ...currentTransportLimits, maxQueuedEvents: 1 },
      true,
    );

    writer.send(changed(events.publishChanged()));
    writer.send(changed(events.publishChanged()));
    writer.send(changed(events.publishChanged()));
    events.publishChanged();
    writer.send(changed(4));

    socket.completeSend();
    socket.completeSend();
    expect(writer.acknowledgeSnapshot(3)).toBe(false);

    writer.send({
      _tag: "ResnapshotRequired",
      currentSequence: 4,
      reason: "OutgoingQueueOverflow",
    });
    socket.completeSend();
    expect(writer.acknowledgeSnapshot(4)).toBe(true);

    writer.send(changed(events.publishChanged()));
    expect(JSON.parse(socket.messages.at(-1) ?? "")).toEqual({
      _tag: "EnvironmentChanged",
      sequence: 5,
    });
  });
});

function changed(sequence: number) {
  return { _tag: "EnvironmentChanged" as const, sequence };
}

class ControlledWebSocket {
  readonly messages: string[] = [];
  readonly readyState = 1;
  private readonly callbacks: Array<(error?: Error) => void> = [];

  close() {}

  send(message: string, callback: (error?: Error) => void) {
    this.messages.push(message);
    this.callbacks.push(callback);
  }

  completeSend() {
    const callback = this.callbacks.shift();
    if (callback === undefined) {
      throw new Error("No WebSocket send is pending.");
    }
    callback();
  }

  terminate() {}
}
