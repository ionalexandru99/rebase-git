import { describe, expect, it } from "vite-plus/test";
import {
  environmentProtocol,
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
    ).resolves.toMatchObject({
      _tag: "Answered",
      message: {
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
      },
    });
  });
});
