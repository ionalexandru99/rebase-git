import { request } from "node:http";
import {
  createCurrentEnvironmentHello,
  currentTransportLimits,
  EnvironmentAuthorizationHttpApi,
  EnvironmentHttpApi,
  environmentDiscoveryPath,
  environmentLivePath,
  environmentSnapshotPath,
  type RouteResultValue,
} from "@rebase/contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { openTestServer } from "#tests-support/server";

describe("Environment transport", () => {
  it("serves typed discovery and a bounded base snapshot", async () => {
    await withListener(async (origin, environmentId, credential) => {
      const discoveryResponse = await fetch(
        `${origin}${environmentDiscoveryPath}`,
      );
      expect(discoveryResponse.status).toBe(200);
      expect(discoveryResponse.headers.get("cache-control")).toBe("no-store");
      const discovery = okValue(
        Schema.decodeUnknownSync(EnvironmentHttpApi.discovery.response)(
          await discoveryResponse.json(),
        ),
      );
      expect(discovery).toMatchObject({
        environmentId,
        productVersion: "0.0.0",
        protocol: { major: 3, minor: 0, minimumSupportedMinor: 0 },
        limits: currentTransportLimits,
      });

      const snapshotResponse = await fetch(
        `${origin}${environmentSnapshotPath}`,
        { headers: { authorization: `Bearer ${credential}` } },
      );
      expect(snapshotResponse.status).toBe(200);
      expect(
        okValue(
          Schema.decodeUnknownSync(EnvironmentHttpApi.snapshot.response)(
            await snapshotResponse.json(),
          ),
        ),
      ).toEqual({ environmentId, sequence: 0 });
    });
  });

  it("advertises the capabilities of the registered features", async () => {
    await withListener(async (origin) => {
      const response = await fetch(`${origin}${environmentDiscoveryPath}`);
      const discovery = okValue(
        Schema.decodeUnknownSync(EnvironmentHttpApi.discovery.response)(
          await response.json(),
        ),
      );
      const names = discovery.capabilities.map(({ name }) => name);
      expect(names).toEqual(
        expect.arrayContaining([
          "environment-events",
          "repository-history",
          "repository-refs",
        ]),
      );
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
    const server = await openTestServer();
    const socket = await openWebSocket(server.origin, server.owner.value);
    const closed = nextClose(socket);
    await server.close();

    await expect(closed).resolves.toMatchObject({ code: 1006 });
  });

  it("requires a hello before application calls and rejects a second hello", async () => {
    await withListener(async (origin, _, credential) => {
      const socket = await openWebSocket(origin, credential);
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
    await withListener(async (origin, _, credential) => {
      const socket = await openWebSocket(origin, credential);
      const response = nextMessage(socket);
      socket.send("{");
      expect(await response).toMatchObject({ _tag: "Defect" });
    });
  });

  it("closes sockets that exceed the advertised frame limit", async () => {
    await withListener(async (origin, _, credential) => {
      const socket = await openWebSocket(origin, credential);
      const closed = nextClose(socket);
      socket.send(
        "x".repeat(currentTransportLimits.maxWebSocketRequestBytes + 1),
      );
      expect(await closed).toMatchObject({ code: 1009 });
    });
  });

  it("closes sockets that never complete the handshake", async () => {
    await withListener(async (origin, _, credential) => {
      const socket = await openWebSocket(origin, credential);
      expect(await nextClose(socket)).toEqual({
        code: 1008,
        reason: "HandshakeRequired",
      });
    });
  });
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

async function withListener(
  run: (
    origin: string,
    environmentId: string,
    credential: string,
  ) => Promise<void>,
) {
  const server = await openTestServer();
  await run(server.origin, server.environmentId, server.owner.value);
}

async function openWebSocket(origin: string, credential: string) {
  const minted = await fetch(
    `${origin}${EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path}`,
    {
      headers: { authorization: `Bearer ${credential}`, origin },
      method: "POST",
    },
  );
  const { value } = (await minted.json()) as {
    readonly value: { readonly ticket: string };
  };
  return connectWebSocket(origin, value.ticket);
}

function connectWebSocket(origin: string, ticket: string) {
  return new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}?ticket=${ticket}`,
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

function okValue<Value>(result: RouteResultValue<Value, unknown>) {
  if (result._tag !== "Ok") throw new Error("Expected an Ok response.");
  return result.value;
}
