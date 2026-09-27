import { request } from "node:http";
import {
  EnvironmentAuthorizationApi,
  environmentBrowserSessionPath,
  environmentLivePath,
  environmentPairingExchangePath,
  environmentProtocol,
  environmentSubprotocol,
  unauthorizedCloseCode,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import WebSocket from "ws";
import { exchangePairing, openTestServer } from "#tests-support/server";
import { EnvironmentAccessDenied } from "#web/app/environment/environment-connection";

describe("Environment authorization transport", () => {
  it("opens the socket with a browser session cookie only from the server origin", async () => {
    const { origin, owner, requests } = await openTestServer();
    const pairing = await requests(owner)(
      EnvironmentAuthorizationApi.createPairing,
      undefined,
    );
    const response = await postJson(origin, environmentBrowserSessionPath, {
      label: "Browser client",
      pairingMaterial: new URL(pairing.pairingUrl).hash.slice(1),
    });
    expect(response.status).toBe(200);
    const session = (await response.json()) as {
      readonly authorization: { readonly id: string };
    };
    expect(session).not.toHaveProperty("credential");
    const cookieHeader = response.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("SameSite=Strict");
    expect(cookieHeader).toContain("Path=/api");
    const cookie = cookieHeader.split(";")[0] ?? "";

    await expect(helloWithCookie(origin, cookie, origin)).resolves.toContain(
      '"sequence":0',
    );
    await expect(
      helloWithCookie(origin, cookie, "https://attacker.example"),
    ).rejects.toThrow("403");

    await requests(owner)(EnvironmentAuthorizationApi.revokeAuthorization, {
      authorizationId: session.authorization.id,
    });
    await expect(helloWithCookie(origin, cookie, origin)).rejects.toThrow(
      `${unauthorizedCloseCode} RevokedGrant`,
    );
  });

  it("requires the server origin for browser pairing", async () => {
    const { origin } = await openTestServer();
    for (const requestOrigin of [
      undefined,
      "null",
      "http://127.0.0.1:1",
      "https://attacker.example",
    ]) {
      const denied = await fetch(`${origin}${environmentBrowserSessionPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(requestOrigin === undefined ? {} : { origin: requestOrigin }),
        },
        body: JSON.stringify({ label: "Browser", pairingMaterial: "123-456" }),
      });
      expect(await responseResult(denied)).toEqual({
        status: 403,
        body: { _tag: "InvalidOrigin" },
      });
    }
  });

  it("rejects malformed, oversized and excess JSON before exchanging a pairing", async () => {
    const { origin, owner, requests } = await openTestServer();
    const pairing = await requests(owner)(
      EnvironmentAuthorizationApi.createPairing,
      undefined,
    );
    const exchange = {
      label: "Browser client",
      pairingMaterial: new URL(pairing.pairingUrl).hash.slice(1),
    };
    for (const body of [
      "{",
      "{}",
      JSON.stringify({ ...exchange, unexpected: true }),
    ]) {
      const response = await fetch(
        `${origin}${environmentPairingExchangePath}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        },
      );
      expect(await responseResult(response)).toEqual({
        body: { _tag: "InvalidMessage" },
        status: 400,
      });
    }
    const oversized = await postJson(origin, environmentPairingExchangePath, {
      ...exchange,
      label: "x".repeat(70_000),
    });
    expect(await responseResult(oversized)).toEqual({
      body: { _tag: "PayloadTooLarge", limitBytes: 65_536 },
      status: 413,
    });
    await expect(
      exchangePairing(origin, pairing.pairingUrl, "Browser client"),
    ).resolves.toHaveProperty("type", "bearer");
  });

  it("rejects requests addressed to another host", async () => {
    const { origin } = await openTestServer();
    const response = await new Promise<number>(
      (resolveStatus, rejectStatus) => {
        const outgoing = request(
          `${origin}${environmentPairingExchangePath}`,
          { headers: { host: "attacker.example" }, method: "POST" },
          (incoming) => {
            incoming.resume();
            resolveStatus(incoming.statusCode ?? 0);
          },
        );
        outgoing.on("error", rejectStatus);
        outgoing.end("{}");
      },
    );
    expect(response).toBe(403);
  });

  it("pairs another device over the socket and refuses it once revoked", async () => {
    const server = await openTestServer();
    const viewer = await server.pair("Review browser");
    await expect(server.connect(viewer)).resolves.toHaveProperty(
      "environmentId",
      server.environmentId,
    );
    await server.requests(server.owner)(
      EnvironmentAuthorizationApi.revokeAuthorization,
      { authorizationId: viewer.authorizationId },
    );
    await expect(server.connect(viewer)).rejects.toEqual(
      new EnvironmentAccessDenied({ failure: { _tag: "RevokedGrant" } }),
    );
  });
});

function helloWithCookie(origin: string, cookie: string, socketOrigin: string) {
  return new Promise<string>((resolveHello, rejectHello) => {
    const socket = new WebSocket(
      `${origin.replace("http://", "ws://")}${environmentLivePath}`,
      [environmentSubprotocol],
      { headers: { cookie, origin: socketOrigin } },
    );
    socket.once("unexpected-response", (_, response) =>
      rejectHello(new Error(String(response.statusCode))),
    );
    socket.once("close", (code, reason) =>
      rejectHello(new Error(`${code} ${reason.toString()}`)),
    );
    socket.once("open", () =>
      socket.send(
        JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "Hello",
          payload: { protocol: environmentProtocol },
          headers: [],
        }),
      ),
    );
    socket.once("message", (data) => {
      resolveHello(data.toString());
      socket.close();
    });
  });
}

function postJson(origin: string, path: string, body: unknown) {
  return fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

async function responseResult(response: Response) {
  return { body: await response.json(), status: response.status };
}
