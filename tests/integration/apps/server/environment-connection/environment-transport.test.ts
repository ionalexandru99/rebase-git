import { request } from "node:http";
import {
  createCurrentEnvironmentHello,
  currentTransportLimits,
  EnvironmentDiscovery,
  EnvironmentHelloResult,
  EnvironmentServerMessage,
  EnvironmentSnapshot,
  environmentDiscoveryPath,
  environmentLivePath,
  environmentSnapshotPath,
} from "@rebase/contracts";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher.contract";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

const environmentId = "00000000-0000-4000-8000-000000000001";

describe("Environment transport", () => {
  it("serves typed discovery and a bounded base snapshot", async () => {
    await withListener(async (origin) => {
      const discoveryResponse = await fetch(
        `${origin}${environmentDiscoveryPath}`,
      );
      expect(discoveryResponse.status).toBe(200);
      expect(discoveryResponse.headers.get("cache-control")).toBe("no-store");
      const discovery = Schema.decodeUnknownSync(EnvironmentDiscovery)(
        await discoveryResponse.json(),
      );
      expect(discovery).toMatchObject({
        environmentId,
        productVersion: "0.0.0",
        protocol: { major: 1, minor: 2, minimumSupportedMinor: 0 },
        limits: currentTransportLimits,
      });

      const snapshotResponse = await fetch(
        `${origin}${environmentSnapshotPath}`,
      );
      expect(snapshotResponse.status).toBe(200);
      expect(
        Schema.decodeUnknownSync(EnvironmentSnapshot)(
          await snapshotResponse.json(),
        ),
      ).toEqual({ environmentId, sequence: 0 });
    });
  });

  it("completes hello negotiation and rejects a major mismatch", async () => {
    await withListener(async (origin) => {
      const acceptedSocket = await openWebSocket(origin);
      acceptedSocket.send(
        JSON.stringify(createCurrentEnvironmentHello("0.0.0")),
      );
      const accepted = Schema.decodeUnknownSync(EnvironmentHelloResult)(
        JSON.parse(await nextTextMessage(acceptedSocket)),
      );
      expect(accepted).toMatchObject({
        _tag: "HelloAccepted",
        environmentId,
        protocol: { major: 1, minor: 2 },
      });
      acceptedSocket.close();

      const rejectedSocket = await openWebSocket(origin);
      const rejectedClose = nextClose(rejectedSocket);
      rejectedSocket.send(
        JSON.stringify({
          ...createCurrentEnvironmentHello("0.0.0"),
          protocol: { major: 2, minor: 0, minimumSupportedMinor: 0 },
        }),
      );
      const rejected = Schema.decodeUnknownSync(EnvironmentHelloResult)(
        JSON.parse(await nextTextMessage(rejectedSocket)),
      );
      expect(rejected).toMatchObject({
        _tag: "HelloRejected",
        failure: { _tag: "ProtocolMajorMismatch" },
      });
      await expect(rejectedClose).resolves.toMatchObject({
        code: 1008,
      });
    });
  });

  it("allows hello exactly once and before control messages", async () => {
    await withListener(async (origin) => {
      const beforeHello = await openWebSocket(origin);
      beforeHello.send(
        JSON.stringify({ _tag: "SnapshotApplied", sequence: 0 }),
      );
      expect(
        Schema.decodeUnknownSync(EnvironmentHelloResult)(
          JSON.parse(await nextTextMessage(beforeHello)),
        ),
      ).toMatchObject({
        _tag: "HelloRejected",
        failure: { _tag: "HandshakeRequired" },
      });

      const duplicateHello = await openWebSocket(origin);
      const hello = JSON.stringify(createCurrentEnvironmentHello("0.0.0"));
      duplicateHello.send(hello);
      await nextTextMessage(duplicateHello);
      duplicateHello.send(hello);
      expect(
        Schema.decodeUnknownSync(EnvironmentHelloResult)(
          JSON.parse(await nextTextMessage(duplicateHello)),
        ),
      ).toMatchObject({
        _tag: "HelloRejected",
        failure: { _tag: "HandshakeAlreadyCompleted" },
      });
    });
  });

  it("sends only behavior enabled by negotiated capabilities", async () => {
    await withListener(async (origin, events) => {
      events.publishChanged();
      events.publishChanged();
      const minorZeroSocket = await openWebSocket(origin);
      minorZeroSocket.send(
        JSON.stringify({
          ...createCurrentEnvironmentHello("0.0.0", 0),
          capabilities: [
            {
              introducedInMinor: 0,
              name: "environment-events",
              version: 1,
            },
          ],
          protocol: { major: 1, minor: 0, minimumSupportedMinor: 0 },
        }),
      );
      await nextTextMessage(minorZeroSocket);
      const changed = nextTextMessage(minorZeroSocket);
      events.publishChanged();
      expect(
        Schema.decodeUnknownSync(EnvironmentServerMessage)(
          JSON.parse(await changed),
        ),
      ).toEqual({ _tag: "EnvironmentChanged", sequence: 3 });
      minorZeroSocket.close();

      const noEventsSocket = await openWebSocket(origin);
      noEventsSocket.send(
        JSON.stringify({
          ...createCurrentEnvironmentHello("0.0.0"),
          capabilities: [],
        }),
      );
      await nextTextMessage(noEventsSocket);
      const unexpected = expectNoTextMessage(noEventsSocket);
      events.publishChanged();
      await unexpected;
      noEventsSocket.close();
    });
  });

  it("rejects invalid, binary, and oversized WebSocket messages", async () => {
    await withListener(async (origin) => {
      const invalidSocket = await openWebSocket(origin);
      invalidSocket.send("not json");
      expect(
        Schema.decodeUnknownSync(EnvironmentHelloResult)(
          JSON.parse(await nextTextMessage(invalidSocket)),
        ),
      ).toEqual({
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });

      const binarySocket = await openWebSocket(origin);
      binarySocket.send(new Uint8Array([1, 2, 3]));
      expect(
        Schema.decodeUnknownSync(EnvironmentHelloResult)(
          JSON.parse(await nextTextMessage(binarySocket)),
        ),
      ).toEqual({
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });

      const excessPropertySocket = await openWebSocket(origin);
      excessPropertySocket.send(
        JSON.stringify({
          ...createCurrentEnvironmentHello("0.0.0"),
          injected: true,
        }),
      );
      expect(
        Schema.decodeUnknownSync(EnvironmentHelloResult)(
          JSON.parse(await nextTextMessage(excessPropertySocket)),
        ),
      ).toEqual({
        _tag: "HelloRejected",
        failure: { _tag: "InvalidMessage" },
      });

      const oversizedSocket = await openWebSocket(origin);
      oversizedSocket.send(
        "x".repeat(currentTransportLimits.maxWebSocketRequestBytes + 1),
      );
      await expect(nextClose(oversizedSocket)).resolves.toMatchObject({
        code: 1009,
      });
    });
  });

  it("requires a fresh snapshot when the client reports a sequence gap", async () => {
    await withListener(async (origin, events) => {
      events.publishChanged();
      events.publishChanged();
      const socket = await openWebSocket(origin);
      const initialMessages = nextTextMessages(socket, 2);
      socket.send(JSON.stringify(createCurrentEnvironmentHello("0.0.0", 0)));
      const [acceptedMessage, resnapshotMessage] = await initialMessages;
      Schema.decodeUnknownSync(EnvironmentHelloResult)(
        JSON.parse(acceptedMessage ?? ""),
      );

      expect(
        Schema.decodeUnknownSync(EnvironmentServerMessage)(
          JSON.parse(resnapshotMessage ?? ""),
        ),
      ).toEqual({
        _tag: "ResnapshotRequired",
        currentSequence: 2,
        reason: "SequenceGap",
      });

      socket.send(JSON.stringify({ _tag: "SnapshotApplied", sequence: 1 }));
      expect(
        Schema.decodeUnknownSync(EnvironmentServerMessage)(
          JSON.parse(await nextTextMessage(socket)),
        ),
      ).toEqual({
        _tag: "ResnapshotRequired",
        currentSequence: 2,
        reason: "SequenceGap",
      });
      socket.close();
    });
  });

  it("counts and rejects HTTP bodies beyond the advertised limit", async () => {
    await withListener(async (origin) => {
      const response = await sendChunkedBody(
        `${origin}${environmentDiscoveryPath}`,
        currentTransportLimits.maxHttpRequestBytes + 1,
      );
      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        _tag: "PayloadTooLarge",
        limitBytes: currentTransportLimits.maxHttpRequestBytes,
      });
    });
  });

  it("rejects a streaming HTTP body before the sender finishes it", async () => {
    await withListener(async (origin) => {
      const response = await sendUnfinishedChunkedBody(
        `${origin}${environmentDiscoveryPath}`,
        currentTransportLimits.maxHttpRequestBytes + 1,
      );
      expect(response.status).toBe(413);
    });
  });

  it("closes upgraded sockets with the listener scope", async () => {
    let closed: ReturnType<typeof nextClose> | undefined;
    await withListener(async (origin) => {
      const socket = await openWebSocket(origin);
      socket.send(JSON.stringify(createCurrentEnvironmentHello("0.0.0")));
      await nextTextMessage(socket);
      closed = nextClose(socket);
    });

    await expect(closed).resolves.toMatchObject({ code: 1006 });
  });
});

function withListener(
  run: (origin: string, events: EnvironmentEventPublisher) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = createEnvironmentEventPublisher();
        const listener = yield* acquireEnvironmentListener({
          environmentId,
          events,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() => run(listener.origin, events));
      }),
    ),
  );
}

function openWebSocket(origin: string) {
  return new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}`,
    );
    socket.addEventListener("open", () => resolveOpen(socket), { once: true });
    socket.addEventListener(
      "error",
      () => rejectOpen(new Error("WebSocket failed")),
      {
        once: true,
      },
    );
  });
}

function nextTextMessage(socket: WebSocket) {
  return new Promise<string>((resolveMessage, rejectMessage) => {
    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") {
          rejectMessage(new Error("Expected a text WebSocket message."));
          return;
        }
        resolveMessage(event.data);
      },
      { once: true },
    );
  });
}

function nextTextMessages(socket: WebSocket, count: number) {
  return new Promise<ReadonlyArray<string>>(
    (resolveMessages, rejectMessages) => {
      const messages: string[] = [];
      const received = (event: MessageEvent) => {
        if (typeof event.data !== "string") {
          socket.removeEventListener("message", received);
          rejectMessages(new Error("Expected a text WebSocket message."));
          return;
        }
        messages.push(event.data);
        if (messages.length === count) {
          socket.removeEventListener("message", received);
          resolveMessages(messages);
        }
      };
      socket.addEventListener("message", received);
    },
  );
}

function expectNoTextMessage(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const received = () => {
      clearTimeout(timeout);
      reject(new Error("Received an unexpected WebSocket message."));
    };
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", received);
      resolve();
    }, 50);
    socket.addEventListener("message", received, { once: true });
  });
}

function nextClose(socket: WebSocket) {
  return new Promise<{ readonly code: number; readonly reason: string }>(
    (resolveClose) => {
      socket.addEventListener(
        "close",
        (event) => resolveClose({ code: event.code, reason: event.reason }),
        { once: true },
      );
    },
  );
}

function sendChunkedBody(url: string, byteLength: number) {
  return new Promise<{ readonly body: unknown; readonly status: number }>(
    (resolveResponse, rejectResponse) => {
      const outgoing = request(
        url,
        { headers: { "transfer-encoding": "chunked" }, method: "GET" },
        (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            body += chunk;
          });
          incoming.on("end", () => {
            resolveResponse({
              body: JSON.parse(body),
              status: incoming.statusCode ?? 0,
            });
          });
        },
      );
      outgoing.on("error", rejectResponse);
      outgoing.end("x".repeat(byteLength));
    },
  );
}

function sendUnfinishedChunkedBody(url: string, byteLength: number) {
  return new Promise<{ readonly status: number }>(
    (resolveResponse, rejectResponse) => {
      const outgoing = request(
        url,
        { headers: { "transfer-encoding": "chunked" }, method: "GET" },
        (incoming) => {
          incoming.resume();
          incoming.on("end", () => {
            resolveResponse({ status: incoming.statusCode ?? 0 });
            outgoing.destroy();
          });
        },
      );
      outgoing.on("error", rejectResponse);
      outgoing.write("x".repeat(byteLength));
    },
  );
}
