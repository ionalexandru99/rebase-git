import { request } from "node:http";
import {
  createCurrentEnvironmentHello,
  currentTransportLimits,
  EnvironmentDiscovery,
  EnvironmentSnapshot,
  environmentDiscoveryPath,
  environmentLivePath,
  environmentSnapshotPath,
} from "@rebase/contracts";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";

const environmentId = "00000000-0000-4000-8000-000000000001";
const testAuthorization = createTestAuthorization();

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
        protocol: { major: 2, minor: 5, minimumSupportedMinor: 0 },
        limits: currentTransportLimits,
      });
      expect(
        discovery.capabilities.some(
          (capability) => capability.name === "repository-history",
        ),
      ).toBe(false);

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

  it("rejects a non-empty HTTP body as an invalid message", async () => {
    await withListener(async (origin) => {
      const response = await sendChunkedBody(
        `${origin}${environmentDiscoveryPath}`,
        1,
      );
      expect(response).toEqual({
        body: { _tag: "InvalidMessage" },
        status: 400,
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
      closed = nextClose(socket);
    });

    await expect(closed).resolves.toMatchObject({ code: 1006 });
  });

  it("requires a hello before application calls and rejects a second hello", async () => {
    await withListener(async (origin) => {
      const socket = await openWebSocket(origin);
      expect(
        await rpcRequest(socket, "1", "WatchEnvironment", null),
      ).toMatchObject({
        _tag: "Exit",
        exit: {
          _tag: "Failure",
          cause: [{ _tag: "Fail", error: { _tag: "AuthorizationDenied" } }],
        },
      });
      const hello = createCurrentEnvironmentHello("0.0.0");
      expect(await rpcRequest(socket, "2", "Hello", hello)).toMatchObject({
        _tag: "Exit",
        exit: { _tag: "Success", value: { _tag: "HelloAccepted" } },
      });
      expect(await rpcRequest(socket, "3", "Hello", hello)).toMatchObject({
        _tag: "Exit",
        exit: {
          _tag: "Success",
          value: {
            _tag: "HelloRejected",
            failure: { _tag: "HandshakeAlreadyCompleted" },
          },
        },
      });
    });
  });

  it("rejects malformed JSON frames", async () => {
    await withListener(async (origin) => {
      const socket = await openWebSocket(origin);
      const response = nextMessage(socket);
      socket.send("{");
      expect(await response).toMatchObject({ _tag: "Defect" });
    });
  });

  it("closes sockets that exceed the advertised frame limit", async () => {
    await withListener(async (origin) => {
      const socket = await openWebSocket(origin);
      const closed = nextClose(socket);
      socket.send(
        "x".repeat(currentTransportLimits.maxWebSocketRequestBytes + 1),
      );
      expect(await closed).toMatchObject({ code: 1009 });
    });
  });

  it("closes sockets that never complete the handshake", async () => {
    await withListener(async (origin) => {
      const socket = await openWebSocket(origin);
      expect(await nextClose(socket)).toEqual({
        code: 1008,
        reason: "HandshakeRequired",
      });
    });
  }, 10_000);
});

function rpcRequest(
  socket: WebSocket,
  id: string,
  tag: string,
  payload?: unknown,
) {
  const response = nextMessage(socket);
  socket.send(
    JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }),
  );
  return response;
}

function nextMessage(socket: WebSocket) {
  return new Promise<unknown>((resolveMessage) => {
    socket.addEventListener(
      "message",
      (event) => resolveMessage(JSON.parse(event.data)),
      { once: true },
    );
  });
}

function withListener(
  run: (origin: string, events: EnvironmentEventPublisher) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const events = createEnvironmentEventPublisher();
        const listener = yield* acquireEnvironmentListener({
          authorization: testAuthorization,
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
      `${origin.replace("http://", "ws://")}${environmentLivePath}?ticket=test-ticket`,
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

function createTestAuthorization(): EnvironmentAuthorization {
  const authorization = {
    capabilities: ["environment.read" as const],
    id: "00000000-0000-4000-8000-000000000002",
    label: "Test device",
    role: "custom" as const,
  };
  return {
    authorize: () => Effect.succeed(authorization),
    consumeTicket: () => Effect.succeed(authorization),
    createPairing: () =>
      Effect.succeed({
        expiresAt: "2026-08-21T12:10:00.000Z",
        material: "test-pairing-material-000000000000000000000",
      }),
    exchangePairing: () =>
      Effect.succeed({ authorization, credential: "test-credential-material" }),
    mintTicket: () =>
      Effect.succeed({
        expiresAt: "2026-08-21T12:00:30.000Z",
        ticket: "test-ticket",
      }),
    revoke: (_, authorizationId) =>
      Effect.succeed({
        authorizationId,
        revokedAt: "2026-08-21T12:00:00.000Z",
      }),
  };
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
