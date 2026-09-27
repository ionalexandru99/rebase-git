import {
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
  unauthorizedCloseCode,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { openTestServer } from "#tests-support/server";

describe("Environment socket", () => {
  it.each([
    ["no credential", [environmentSubprotocol]],
    ["an unpaired credential", [environmentSubprotocol, "rebase.v1.unpaired"]],
  ])(
    "closes a socket that arrives with %s before serving it",
    async (_, protocols) => {
      const { origin } = await openTestServer();
      const socket = new WebSocket(socketUrl(origin), protocols);
      const closed = nextClose(socket);
      socket.addEventListener("open", () =>
        socket.send(request("1", "Hello", { protocol: environmentProtocol })),
      );

      expect(await closed).toEqual({
        code: unauthorizedCloseCode,
        reason: "InvalidGrant",
      });
    },
  );

  it("answers a client that speaks another protocol with the server protocol", async () => {
    const { origin, owner } = await openTestServer();
    const socket = await openSocket(origin, owner.value);
    const answer = nextMessage(socket);
    socket.send(request("1", "Hello", { protocol: environmentProtocol + 1 }));

    expect(await answer).toMatchObject({
      _tag: "Exit",
      exit: {
        _tag: "Failure",
        cause: [
          {
            _tag: "Fail",
            error: {
              _tag: "ProtocolMismatch",
              serverProtocol: environmentProtocol,
            },
          },
        ],
      },
    });
    socket.close();
  });
});

function request(id: string, tag: string, payload: unknown) {
  return JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] });
}

function socketUrl(origin: string) {
  return `${origin.replace("http://", "ws://")}${environmentLivePath}`;
}

function openSocket(origin: string, credential: string) {
  return new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(socketUrl(origin), [
      environmentSubprotocol,
      credential,
    ]);
    socket.addEventListener("open", () => resolveOpen(socket), { once: true });
    socket.addEventListener(
      "error",
      () => rejectOpen(new Error("WebSocket failed")),
      { once: true },
    );
  });
}

function nextMessage(socket: WebSocket) {
  return new Promise<unknown>((resolveMessage) => {
    socket.addEventListener(
      "message",
      (event) => resolveMessage(JSON.parse(String(event.data))),
      { once: true },
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
