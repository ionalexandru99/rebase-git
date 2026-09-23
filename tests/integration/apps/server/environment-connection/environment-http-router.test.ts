import {
  type EnvironmentAccessCapability,
  EnvironmentAuthorizationHttpApi,
  EnvironmentFilesystemHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import {
  type EnvironmentAuthorization,
  EnvironmentAuthorizationError,
} from "#server/domain/environment-authorization.contract";
import { EnvironmentFilesystemError } from "#server/features/environment-filesystem/environment-filesystem";
import { testEnvironmentFeatures } from "#tests-integration/apps/server/environment-connection/test-environment-features";

const writerCredential = "writer";
const granted: ReadonlySet<EnvironmentAccessCapability> = new Set([
  "environment.read",
  "repository.write",
]);
const device = {
  capabilities: [...granted],
  id: "00000000-0000-4000-8000-000000000003",
  label: "Router test device",
  role: "custom" as const,
};

const routes = [
  httpRoute(RepositoryCatalogHttpApi.list, () =>
    Effect.succeed({ repositories: [] }),
  ),
  httpRoute(EnvironmentAuthorizationHttpApi.mintWebSocketTicket, () =>
    Effect.succeed({ expiresAt: "2026-08-21T12:00:30.000Z", ticket: "t" }),
  ),
  httpRoute(
    EnvironmentFilesystemHttpApi.listDirectory,
    (directory) =>
      directory.path === "/missing"
        ? Effect.fail(
            new EnvironmentFilesystemError({
              failure: {
                _tag: "EnvironmentDirectoryRejected",
                reason: "NotFound",
              },
            }),
          )
        : Effect.succeed({
            breadcrumbs: [],
            entries: [],
            path: directory.path ?? "/",
            truncated: directory.includeHidden === true,
          }),
    { failureStatus: () => 404 as const },
  ),
];

describe("Environment HTTP router", () => {
  it("rejects duplicate HTTP registrations before opening a listener", async () => {
    await expect(
      withListener(async () => {}, [
        { capabilities: [], httpRoutes: routes },
        { capabilities: [], httpRoutes: routes },
      ]),
    ).rejects.toThrow("Duplicate HTTP route: GET /api/repositories");
  });

  it("answers unknown paths and unsupported methods from the route table", async () => {
    await withListener(async (origin) => {
      expect((await fetch(`${origin}/api/unknown`)).status).toBe(404);
      const wrongMethod = await fetch(
        `${origin}${RepositoryCatalogHttpApi.list.path}`,
        { method: "POST", headers: { origin } },
      );
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET");
    });
  });

  it("rejects missing capabilities and stray bodies before running the handler", async () => {
    await withListener(async (origin) => {
      const denied = await fetch(
        `${origin}${RepositoryCatalogHttpApi.list.path}`,
        { headers: { authorization: `Bearer ${writerCredential}` } },
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        _tag: "CapabilityDenied",
        capability: "repository.read",
      });
      const stray = await fetch(
        `${origin}${EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path}`,
        {
          body: " ",
          headers: { authorization: `Bearer ${writerCredential}`, origin },
          method: "POST",
        },
      );
      expect(stray.status).toBe(400);
      expect(await stray.json()).toEqual({ _tag: "InvalidMessage" });
    });
  });

  it("decodes the command, encodes the result, and maps feature failures", async () => {
    await withListener(async (origin) => {
      const listed = await postJson(origin, {
        path: "/home",
        includeHidden: true,
      });
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({
        breadcrumbs: [],
        entries: [],
        path: "/home",
        truncated: true,
      });
      const malformed = await postJson(origin, { path: "/home", extra: 1 });
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toEqual({ _tag: "InvalidMessage" });
      const missing = await postJson(origin, { path: "/missing" });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        _tag: "EnvironmentDirectoryRejected",
        reason: "NotFound",
      });
    });
  });
});

function postJson(origin: string, body: unknown) {
  return fetch(`${origin}${EnvironmentFilesystemHttpApi.listDirectory.path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${writerCredential}`,
      "content-type": "application/json",
      origin,
    },
    method: "POST",
  });
}

function withListener(
  use: (origin: string) => Promise<void>,
  features: readonly EnvironmentFeature[] = [
    { capabilities: [], httpRoutes: routes },
  ],
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* acquireEnvironmentListener({
          authorization: createTestAuthorization(),
          environmentId: "00000000-0000-4000-8000-000000000001",
          events: createEnvironmentEventPublisher(),
          features: testEnvironmentFeatures(features),
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.promise(() => use(listener.origin));
      }),
    ),
  );
}

function createTestAuthorization(): EnvironmentAuthorization {
  return {
    authorize: (credential, capability) =>
      credential === writerCredential && granted.has(capability)
        ? Effect.succeed(device)
        : Effect.fail(
            new EnvironmentAuthorizationError({
              failure: { _tag: "CapabilityDenied", capability },
            }),
          ),
    consumeTicket: () => Effect.succeed(device),
    createPairing: () =>
      Effect.succeed({ expiresAt: "2026-08-21T12:10:00.000Z", material: "m" }),
    exchangePairing: () =>
      Effect.succeed({ authorization: device, credential: writerCredential }),
    mintTicket: () =>
      Effect.succeed({ expiresAt: "2026-08-21T12:00:30.000Z", ticket: "t" }),
    revoke: (_, authorizationId) =>
      Effect.succeed({
        authorizationId,
        revokedAt: "2026-08-21T12:00:00.000Z",
      }),
  };
}
