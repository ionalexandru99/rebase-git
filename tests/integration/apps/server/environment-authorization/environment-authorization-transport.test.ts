import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCurrentEnvironmentHello,
  EnvironmentAuthorizationHttpApi,
  environmentLivePath,
  environmentSnapshotPath,
} from "@rebase/contracts";
import {
  connectCurrentEnvironment,
  EnvironmentAuthorizationRejected,
  exchangeEnvironmentPairing as exchangeEnvironmentPairingFromClient,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
} from "@rebase/web/features/environment-connection";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";

const environmentId = "00000000-0000-4000-8000-000000000001";
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("Environment authorization transport", () => {
  it("rejects malformed, invalid, and excess JSON fields before exchanging a pairing", async () => {
    await withAuthorizedListener(async ({ authorization, origin }) => {
      const pairing = await run(
        authorization.createPairing({ capabilities: [], role: "viewer" }),
      );
      const exchange = {
        label: "Browser client",
        pairingMaterial: pairing.material,
      };
      for (const body of [
        "{",
        "{}",
        JSON.stringify({ ...exchange, unexpected: true }),
      ]) {
        const response = await fetch(
          `${origin}${EnvironmentAuthorizationHttpApi.exchangePairing.path}`,
          {
            method: "POST",
            headers: { "content-type": "application/json", origin },
            body,
          },
        );
        expect(await responseResult(response)).toEqual({
          body: { _tag: "InvalidMessage" },
          status: 400,
        });
      }
      await expect(
        exchangeEnvironmentPairingFromClient(origin, exchange),
      ).resolves.toHaveProperty("credential");
    });
  });

  it("returns the allowed method and rejects bodies on empty-body routes", async () => {
    await withAuthorizedListener(async ({ origin, owner }) => {
      const url = `${origin}${EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path}`;
      const wrongMethod = await fetch(url);
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("POST");
      expect(await wrongMethod.text()).toBe("");

      const nonEmpty = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${owner.credential}`, origin },
        body: " ",
      });
      expect(await responseResult(nonEmpty)).toEqual({
        body: { _tag: "InvalidMessage" },
        status: 400,
      });
    });
  });

  it("connects the browser client with the exchanged device credential", async () => {
    await withAuthorizedListener(async ({ authorization, origin }) => {
      await expect(
        exchangeEnvironmentPairingFromClient(origin, {
          label: "Browser client",
          pairingMaterial: "123-456",
        }),
      ).rejects.toEqual(
        new EnvironmentAuthorizationRejected({
          failure: { _tag: "InvalidPairing" },
          status: 401,
        }),
      );

      const pairing = await run(
        authorization.createPairing({ capabilities: [], role: "viewer" }),
      );
      const paired = await exchangeEnvironmentPairingFromClient(origin, {
        label: "Browser client",
        pairingMaterial: pairing.material,
      });
      const connection = await connectCurrentEnvironment(origin, "0.0.0", {
        credential: paired.credential,
      });

      await expect(
        fetchEnvironmentSnapshot(
          origin,
          connection.discovery,
          paired.credential,
        ),
      ).resolves.toEqual({ environmentId, sequence: 0 });
      connection.close();
    });
  });

  it("pairs, enforces capabilities, and revokes through HTTP", async () => {
    await withAuthorizedListener(async ({ authorization, origin, owner }) => {
      const unauthenticated = await fetch(
        `${origin}${environmentSnapshotPath}`,
      );
      expect(await responseResult(unauthenticated)).toEqual({
        body: { _tag: "InvalidGrant" },
        status: 401,
      });

      const viewerPairing = await postJson(
        origin,
        EnvironmentAuthorizationHttpApi.createPairing.path,
        { capabilities: [], role: "viewer" },
        owner.credential,
      );
      expect(viewerPairing.status).toBe(201);
      const viewerPairingBody = await viewerPairing.json();
      const pairingUrl = new URL(readString(viewerPairingBody, "pairingUrl"));
      const viewer = await exchangePairing(
        origin,
        pairingUrl.hash.slice(1),
        "Review browser",
      );

      const snapshot = await fetch(`${origin}${environmentSnapshotPath}`, {
        headers: { authorization: `Bearer ${viewer.credential}` },
      });
      expect(snapshot.status).toBe(200);

      const customPairing = await run(
        authorization.createPairing({
          capabilities: ["repository.read"],
          role: "custom",
        }),
      );
      const custom = await exchangePairing(
        origin,
        customPairing.material,
        "Read-only automation",
      );
      const deniedSnapshot = await fetch(
        `${origin}${environmentSnapshotPath}`,
        { headers: { authorization: `Bearer ${custom.credential}` } },
      );
      expect(await responseResult(deniedSnapshot)).toEqual({
        body: {
          _tag: "CapabilityDenied",
          capability: "environment.read",
        },
        status: 403,
      });

      const revocation = await postJson(
        origin,
        EnvironmentAuthorizationHttpApi.revokeAuthorization.path,
        { authorizationId: viewer.authorization.id },
        owner.credential,
      );
      expect(revocation.status).toBe(200);
      const revokedSnapshot = await fetch(
        `${origin}${environmentSnapshotPath}`,
        { headers: { authorization: `Bearer ${viewer.credential}` } },
      );
      expect(await responseResult(revokedSnapshot)).toEqual({
        body: { _tag: "RevokedGrant" },
        status: 401,
      });
      const discovery = await fetchEnvironmentDiscovery(origin);
      await expect(
        fetchEnvironmentSnapshot(origin, discovery, viewer.credential),
      ).rejects.toEqual(
        new EnvironmentAuthorizationRejected({
          failure: { _tag: "RevokedGrant" },
          status: 401,
        }),
      );
      const revokedTicket = await postEmpty(
        origin,
        EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path,
        viewer.credential,
      );
      expect(await responseResult(revokedTicket)).toEqual({
        body: { _tag: "RevokedGrant" },
        status: 401,
      });
    });
  });

  it("validates host and origin before consuming one-time WebSocket tickets", async () => {
    await withAuthorizedListener(async ({ origin, owner }) => {
      const invalidHost = await requestJson(
        `${origin}${environmentSnapshotPath}`,
        {
          authorization: "Bearer invalid",
          host: "attacker.example",
        },
      );
      expect(invalidHost).toEqual({
        body: { _tag: "InvalidHost" },
        status: 403,
      });

      const invalidOrigin = await fetch(
        `${origin}${EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path}`,
        {
          headers: {
            authorization: `Bearer ${owner.credential}`,
            origin: "https://attacker.example",
          },
          method: "POST",
        },
      );
      expect(await responseResult(invalidOrigin)).toEqual({
        body: { _tag: "InvalidOrigin" },
        status: 403,
      });

      const ticket = await mintTicket(origin, owner.credential);
      const invalidSocket = await rejectedWebSocket(
        origin,
        ticket,
        "https://attacker.example",
      );
      expect(invalidSocket).toEqual({
        body: { _tag: "InvalidOrigin" },
        status: 403,
      });

      const socket = await openWebSocket(origin, ticket);
      socket.send(JSON.stringify(createCurrentEnvironmentHello("0.0.0")));
      await expect(nextTextMessage(socket)).resolves.toContain(
        '"_tag":"HelloAccepted"',
      );
      socket.close();

      await expect(rejectedWebSocket(origin, ticket, origin)).resolves.toEqual({
        body: { _tag: "TicketAlreadyUsed" },
        status: 409,
      });
    });
  });
});

function withAuthorizedListener(
  use: (fixture: AuthorizedListenerFixture) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* Effect.promise(() =>
          mkdtemp(join(tmpdir(), "rebase authorization transport ")),
        );
        directories.add(directory);
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(directory, ".rebase")),
        );
        const authorization = createEnvironmentAuthorization(
          context,
          context.serverSecret,
        );
        const ownerPairing = yield* authorization.createPairing({
          capabilities: [],
          role: "owner",
        });
        const events = createEnvironmentEventPublisher();
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId,
          events,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        const owner = yield* Effect.promise(() =>
          exchangePairing(
            listener.origin,
            ownerPairing.material,
            "Owner workstation",
          ),
        );
        yield* Effect.promise(() =>
          use({ authorization, origin: listener.origin, owner }),
        );
      }),
    ),
  );
}

async function exchangePairing(
  origin: string,
  pairingMaterial: string,
  label: string,
) {
  const response = await postJson(
    origin,
    EnvironmentAuthorizationHttpApi.exchangePairing.path,
    { label, pairingMaterial },
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    readonly authorization: { readonly id: string };
    readonly credential: string;
  };
}

async function mintTicket(origin: string, credential: string) {
  const response = await postEmpty(
    origin,
    EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path,
    credential,
  );
  expect(response.status).toBe(201);
  return readString(await response.json(), "ticket");
}

function postJson(
  origin: string,
  path: string,
  body: unknown,
  credential?: string,
) {
  return fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      ...(credential === undefined
        ? {}
        : { authorization: `Bearer ${credential}` }),
    },
    method: "POST",
  });
}

function postEmpty(origin: string, path: string, credential: string) {
  return fetch(`${origin}${path}`, {
    headers: {
      authorization: `Bearer ${credential}`,
      origin,
    },
    method: "POST",
  });
}

function requestJson(url: string, headers: Record<string, string>) {
  return new Promise<{ readonly body: unknown; readonly status: number }>(
    (resolveResponse, rejectResponse) => {
      const outgoing = request(url, { headers }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolveResponse({
            body: JSON.parse(body),
            status: response.statusCode ?? 0,
          });
        });
      });
      outgoing.on("error", rejectResponse);
      outgoing.end();
    },
  );
}

function openWebSocket(origin: string, ticket: string) {
  return new Promise<WebSocket>((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(webSocketUrl(origin, ticket));
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

function rejectedWebSocket(
  origin: string,
  ticket: string,
  requestOrigin: string,
) {
  return new Promise<{ readonly body: unknown; readonly status: number }>(
    (resolveResponse, rejectResponse) => {
      const outgoing = request(
        `${origin}${environmentLivePath}?ticket=${ticket}`,
        {
          headers: {
            connection: "Upgrade",
            origin: requestOrigin,
            "sec-websocket-key": randomBytes(16).toString("base64"),
            "sec-websocket-version": "13",
            upgrade: "websocket",
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => {
            resolveResponse({
              body: JSON.parse(body),
              status: response.statusCode ?? 0,
            });
          });
        },
      );
      outgoing.on("upgrade", (_, socket) => {
        socket.destroy();
        rejectResponse(new Error("Expected the WebSocket upgrade to fail."));
      });
      outgoing.on("error", rejectResponse);
      outgoing.end();
    },
  );
}

function webSocketUrl(origin: string, ticket: string) {
  return `${origin.replace("http://", "ws://")}${environmentLivePath}?ticket=${ticket}`;
}

function nextTextMessage(socket: WebSocket) {
  return new Promise<string>((resolveMessage, rejectMessage) => {
    socket.addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") {
          rejectMessage(new Error("Expected a text WebSocket message."));
        } else {
          resolveMessage(event.data);
        }
      },
      { once: true },
    );
  });
}

async function responseResult(response: Response) {
  return { body: await response.json(), status: response.status };
}

function readString(value: unknown, property: string) {
  if (
    typeof value !== "object" ||
    value === null ||
    !(property in value) ||
    typeof value[property as keyof typeof value] !== "string"
  ) {
    throw new Error(`Expected response property "${property}".`);
  }
  return value[property as keyof typeof value] as string;
}

function run<Value, Error>(effect: Effect.Effect<Value, Error>) {
  return Effect.runPromise(effect);
}

interface AuthorizedListenerFixture {
  readonly authorization: EnvironmentAuthorization;
  readonly origin: string;
  readonly owner: {
    readonly authorization: { readonly id: string };
    readonly credential: string;
  };
}
