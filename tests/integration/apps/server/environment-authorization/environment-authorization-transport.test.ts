import { request } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentAuthorizationApi,
  environmentBrowserSessionPath,
  environmentLocalPairingPath,
  environmentPairingExchangePath,
  environmentShutdownPath,
} from "#contracts/environment-authorization/environment-authorization.contract.ts";
import { unauthorizedCloseCode } from "#contracts/environment-connection/environment-rpc.contract.ts";
import { readRuntimeMarker } from "#server/app/runtime/runtime-marker.ts";
import {
  exchangePairing,
  helloOverSocket,
  openTestServer,
} from "#tests-support/server.ts";

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

    await expect(
      helloOverSocket(origin, { headers: { cookie, origin } }),
    ).resolves.toMatchObject({
      _tag: "Answered",
      greeting: { environmentId: expect.any(String) },
    });
    const localhostOrigin = origin.replace("127.0.0.1", "localhost");
    await expect(
      helloOverSocket(localhostOrigin, {
        headers: { cookie, origin: localhostOrigin },
      }),
    ).resolves.toMatchObject({
      _tag: "Answered",
      greeting: { environmentId: expect.any(String) },
    });
    await expect(
      helloOverSocket(origin, {
        headers: { cookie, origin: "https://attacker.example" },
      }),
    ).resolves.toEqual({
      _tag: "Closed",
      code: unauthorizedCloseCode,
      reason: "InvalidOrigin",
    });
    await expect(
      helloOverSocket(origin, { headers: { cookie } }),
    ).resolves.toEqual({
      _tag: "Closed",
      code: unauthorizedCloseCode,
      reason: "InvalidOrigin",
    });
    await expect(
      helloOverSocket(origin, {
        headers: { cookie, origin, host: "attacker.example" },
      }),
    ).resolves.toEqual({
      _tag: "Closed",
      code: unauthorizedCloseCode,
      reason: "InvalidHost",
    });

    await requests(owner)(EnvironmentAuthorizationApi.revokeAuthorization, {
      authorizationId: session.authorization.id,
    });
    await expect(
      helloOverSocket(origin, { headers: { cookie, origin } }),
    ).resolves.toEqual({
      _tag: "Closed",
      code: unauthorizedCloseCode,
      reason: "RevokedGrant",
    });
  });

  it("mints local pairings only for the control token", async () => {
    const { home, origin } = await openTestServer();
    const marker = await readRuntimeMarker(
      join(home, ".rebase", "runtime", "runtime.json"),
    );
    const control = (path: string, token: string, requestOrigin = {}) =>
      fetch(`${origin}${path}`, {
        headers: { authorization: `Bearer ${token}`, ...requestOrigin },
        method: "POST",
      });

    const denied = [
      await control(environmentLocalPairingPath, "wrong"),
      await control(environmentLocalPairingPath, marker?.controlToken ?? "", {
        origin: "https://attacker.example",
      }),
    ];
    expect(denied.map(({ status }) => status)).toEqual([401, 403]);
    const paired = await control(
      environmentLocalPairingPath,
      marker?.controlToken ?? "",
    );
    const { pairingUrl } = (await paired.json()) as { pairingUrl: string };
    await expect(exchangePairing(origin, pairingUrl, "CLI")).resolves.toEqual(
      expect.objectContaining({ type: "bearer" }),
    );
    expect(
      (await control(environmentShutdownPath, marker?.controlToken ?? ""))
        .status,
    ).toBe(404);
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

  it("answers 500 when the pairing exchange fails unexpectedly", async () => {
    const { origin } = await openTestServer({
      authorization: (authorization) => ({
        ...authorization,
        exchangePairing: (exchange) =>
          exchange.label === "Broken"
            ? Promise.reject(new Error("Broken"))
            : authorization.exchangePairing(exchange),
      }),
    });
    const response = await postJson(origin, environmentPairingExchangePath, {
      label: "Broken",
      pairingMaterial: "123-456",
    });
    expect(response.status).toBe(500);
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

  it("opens the socket with a device credential from a page or worker on a file origin", async () => {
    const { origin, owner } = await openTestServer();
    await expect(
      helloOverSocket(origin, {
        credential: owner.value,
        headers: { origin: "file://" },
      }),
    ).resolves.toMatchObject({
      _tag: "Answered",
      greeting: { environmentId: expect.any(String) },
    });
  });

  it("pairs another device over the socket and cuts it off once revoked", async () => {
    const server = await openTestServer();
    const viewer = await server.pair("Review browser");
    const connection = await server.connect(viewer);
    expect(connection.environmentId).toBe(server.environmentId);

    await server.requests(server.owner)(
      EnvironmentAuthorizationApi.revokeAuthorization,
      { authorizationId: viewer.authorizationId },
    );

    await expect(connection.closed).resolves.toBeUndefined();
    await expect(server.connect(viewer)).rejects.toEqual({
      _tag: "EnvironmentAccessDenied",
      failure: { _tag: "RevokedGrant" },
    });
  });
});

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
