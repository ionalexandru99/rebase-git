import { once } from "node:events";
import { describe, expect, it } from "vite-plus/test";
import WebSocket from "ws";
import {
  environmentLivePath,
  environmentProtocol,
  environmentSubprotocol,
  unauthorizedCloseCode,
} from "#contracts/environment-connection/environment-rpc.contract.ts";
import { helloOverSocket, openTestServer } from "#tests-support/server.ts";

describe("Environment socket", () => {
  it("closes a socket that arrives with an unpaired credential before serving it", async () => {
    const { origin } = await openTestServer();

    await expect(
      helloOverSocket(origin, { credential: "rebase.v1.unpaired" }),
    ).resolves.toEqual({
      _tag: "Closed",
      code: unauthorizedCloseCode,
      reason: "InvalidGrant",
    });
  });

  it("answers a client that speaks another protocol with the server protocol", async () => {
    const { origin, owner } = await openTestServer();

    await expect(
      helloOverSocket(origin, {
        credential: owner.value,
        protocol: environmentProtocol + 1,
      }),
    ).resolves.toEqual({
      _tag: "Rejected",
      failure: {
        _tag: "ProtocolMismatch",
        serverProtocol: environmentProtocol,
      },
    });
  });

  it("drops a socket that breaks the WebSocket protocol and keeps serving others", async () => {
    const { origin, owner } = await openTestServer();
    const socket = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}`,
      [environmentSubprotocol, owner.value],
    );
    await once(socket, "open");
    const closed = once(socket, "close");
    (
      socket as unknown as { _socket: { write: (bytes: Buffer) => void } }
    )._socket.write(Buffer.from([0x81, 0x01, 0x61]));
    await closed;

    await expect(
      helloOverSocket(origin, { credential: owner.value }),
    ).resolves.toMatchObject({ _tag: "Answered" });
  });
});
