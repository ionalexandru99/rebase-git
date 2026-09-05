import { createServer, type ServerResponse } from "node:http";
import {
  createCurrentEnvironmentDiscovery,
  createCurrentEnvironmentHello,
  currentTransportLimits,
} from "@rebase/contracts";
import {
  connectCurrentEnvironment,
  connectCurrentEnvironmentEffect,
  connectEnvironment,
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  fetchEnvironmentDiscovery,
  fetchEnvironmentSnapshot,
} from "@rebase/web/features/environment-connection";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";

const environmentId = "00000000-0000-4000-8000-000000000001";
const credential = "test-device-credential";
const testAuthorization = createTestAuthorization();
const encodedSnapshot = JSON.stringify({ environmentId, sequence: 0 });
const oversizedSnapshot = Buffer.from(
  encodedSnapshot.padEnd(currentTransportLimits.maxHttpResponseBytes + 1),
);

describe("browser Environment protocol client", () => {
  it("discovers, negotiates, and snapshots one Environment", async () => {
    await withListener(async (origin, events) => {
      const connection = await connectCurrentEnvironment(origin, "0.0.0", {
        credential,
      });
      expect(connection.negotiated).toMatchObject({
        _tag: "HelloAccepted",
        accessCapabilities: ["environment.read"],
        environmentId,
      });

      await expect(
        fetchEnvironmentSnapshot(origin, connection.discovery, credential),
      ).resolves.toEqual({ environmentId, sequence: 0 });

      const changed = Effect.runPromise(connection.waitForSequence(1));
      events.publishChanged();
      await expect(changed).resolves.toBe(1);
      connection.close();
      await expect(Effect.runPromise(connection.closed)).resolves.toEqual(
        new EnvironmentResponseError({ responseTag: "WebSocket" }),
      );
      await expect(
        Effect.runPromise(connection.waitForSequence(2)),
      ).rejects.toEqual(
        new EnvironmentResponseError({ responseTag: "WebSocket" }),
      );
    });
  });

  it("fetches a fresh snapshot after reconnecting across a sequence gap", async () => {
    await withListener(async (origin, events) => {
      const initial = await connectCurrentEnvironment(origin, "0.0.0", {
        credential,
      });
      initial.close();
      events.publishChanged();
      events.publishChanged();

      const recovered = await connectCurrentEnvironment(origin, "0.0.0", {
        credential,
        lastObservedSequence: 0,
      });
      events.publishChanged();
      await expect(
        Effect.runPromise(recovered.waitForSequence(3)),
      ).resolves.toBe(3);
      expect(recovered.currentSequence()).toBe(3);

      const resumed = Effect.runPromise(recovered.waitForSequence(4));
      events.publishChanged();
      await expect(resumed).resolves.toBe(4);
      recovered.close();
    });
  });

  it("closes an Effect connection when its scope ends", async () => {
    await withListener(async (origin) => {
      const closed = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connectCurrentEnvironmentEffect(
              origin,
              "0.0.0",
              { credential },
            );
            return connection.closed;
          }),
        ),
      );

      await expect(Effect.runPromise(closed)).resolves.toEqual(
        new EnvironmentResponseError({ responseTag: "WebSocket" }),
      );
    });
  });

  it("closes a Promise connection when its signal is aborted", async () => {
    await withListener(async (origin) => {
      const controller = new AbortController();
      const connection = await connectCurrentEnvironment(origin, "0.0.0", {
        credential,
        signal: controller.signal,
      });

      controller.abort();

      await expect(Effect.runPromise(connection.closed)).resolves.toEqual(
        new EnvironmentResponseError({ responseTag: "WebSocket" }),
      );
    });
  });

  it("exposes a tagged protocol rejection", async () => {
    await withListener(async (origin) => {
      const discovery = await fetchEnvironmentDiscovery(origin);
      const incompatibleHello = {
        ...createCurrentEnvironmentHello("0.0.0"),
        protocol: { major: 2, minor: 0, minimumSupportedMinor: 0 },
      };

      await expect(
        connectEnvironment(origin, discovery, incompatibleHello, credential),
      ).rejects.toEqual(
        new EnvironmentHelloRejected({
          failure: {
            _tag: "ProtocolMajorMismatch",
            clientMajor: 2,
            requiredUpdate: "server",
            serverMajor: 1,
          },
        }),
      );
    });
  });

  it("uses the server baseline when resnapshot was not negotiated", async () => {
    await withListener(async (origin, events) => {
      const discovery = await fetchEnvironmentDiscovery(origin);
      const hello = {
        ...createCurrentEnvironmentHello("0.0.0", 12),
        capabilities: [
          {
            introducedInMinor: 0,
            name: "environment-events",
            version: 1,
          },
        ],
        protocol: { major: 1, minor: 0, minimumSupportedMinor: 0 },
      };
      const connection = await connectEnvironment(
        origin,
        discovery,
        hello,
        credential,
      );
      expect(connection.currentSequence()).toBe(0);

      const changed = Effect.runPromise(connection.waitForSequence(1));
      events.publishChanged();
      await expect(changed).resolves.toBe(1);
      connection.close();
    });
  });

  it.each([
    ["declared", writeDeclaredOversizedSnapshot],
    ["streamed", writeStreamedOversizedSnapshot],
  ])("rejects a %s HTTP response above the client limit", async (_, write) => {
    await withSnapshotResponse(write, async (origin) => {
      const discovery = createCurrentEnvironmentDiscovery(
        environmentId,
        "0.0.0",
      );
      await expect(
        fetchEnvironmentSnapshot(origin, discovery, credential),
      ).rejects.toEqual(
        new EnvironmentResponseError({ responseTag: "Snapshot" }),
      );
    });
  });

  it("rejects failures that do not belong to the snapshot route", async () => {
    await withSnapshotResponse(
      (response) => {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ _tag: "InvalidPairing" }));
      },
      async (origin) => {
        const discovery = createCurrentEnvironmentDiscovery(
          environmentId,
          "0.0.0",
        );
        await expect(
          fetchEnvironmentSnapshot(origin, discovery, credential),
        ).rejects.toEqual(
          new EnvironmentResponseError({ responseTag: "Snapshot" }),
        );
      },
    );
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
        ticket: "test-ticket-material-0000000000000000000000000",
      }),
    revoke: (_, authorizationId) =>
      Effect.succeed({
        authorizationId,
        revokedAt: "2026-08-21T12:00:00.000Z",
      }),
  };
}

async function withSnapshotResponse(
  write: (response: ServerResponse) => void,
  run: (origin: string) => Promise<void>,
) {
  const server = createServer((_, response) => write(response));
  await new Promise<void>((resolveListening) => {
    server.listen(0, "127.0.0.1", resolveListening);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the test HTTP server to have a TCP address.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClosed, rejectClosed) => {
      server.close((error) => {
        if (error === undefined) {
          resolveClosed();
        } else {
          rejectClosed(error);
        }
      });
    });
  }
}

function writeDeclaredOversizedSnapshot(response: ServerResponse) {
  response.writeHead(200, {
    "content-length": oversizedSnapshot.byteLength,
  });
  response.end(oversizedSnapshot);
}

function writeStreamedOversizedSnapshot(response: ServerResponse) {
  response.writeHead(200);
  response.write(
    oversizedSnapshot.subarray(0, currentTransportLimits.maxHttpResponseBytes),
  );
  response.end(
    oversizedSnapshot.subarray(currentTransportLimits.maxHttpResponseBytes),
  );
}
