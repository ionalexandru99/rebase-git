import {
  createCurrentEnvironmentHello,
  type EnvironmentHello,
} from "@rebase/contracts";
import {
  connectCurrentEnvironmentEffect,
  connectEnvironmentEffect,
  EnvironmentHelloRejected,
  type EnvironmentProtocolConnection,
  EnvironmentResponseError,
  fetchEnvironmentDiscoveryEffect,
  fetchEnvironmentSnapshotEffect,
} from "@rebase/web/environment-connection";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import type { EnvironmentAuthorization } from "#server/domain/environment-authorization.contract";
import type { EnvironmentEventPublisher } from "#server/domain/environment-event-publisher.contract";
import { environmentAuthorizationFeature } from "#server/features/environment-authorization/index";

const environmentId = "00000000-0000-4000-8000-000000000001";
const credential = { type: "bearer", value: "test-device-credential" } as const;
const testAuthorization = createTestAuthorization();
const closedByClient = new EnvironmentResponseError({
  responseTag: "WebSocket",
});

describe("browser Environment protocol client", () => {
  it("invalidates all refs after a sequence gap and resumes targeted changes without replaying duplicates", async () => {
    const events = createEnvironmentEventPublisher();
    await withListener(
      (origin) =>
        withCurrentConnection(origin, {}, async (connection) => {
          const changed = vi.fn();
          const unsubscribe = connection.subscribeChanges(changed);
          try {
            events.publishChanged([environmentId]);
            events.publishChanged([environmentId]);
            await Effect.runPromise(connection.waitForSequence(2));
            expect(changed).toHaveBeenCalledExactlyOnceWith(undefined);
            events.publishChanged([environmentId]);
            events.publishChanged([environmentId]);
            await Effect.runPromise(connection.waitForSequence(4));
            expect(changed.mock.calls).toEqual([
              [undefined],
              [[environmentId]],
              [[environmentId]],
            ]);
          } finally {
            unsubscribe();
          }
        }),
      {
        ...events,
        subscribe: (listener) =>
          events.subscribe((sequence, repositoryIds) => {
            if (sequence === 1) return;
            listener(sequence, repositoryIds);
            listener(sequence, repositoryIds);
          }),
      },
    );
  });

  for (const identified of [true, false])
    it(`delivers repository changes with identity negotiation ${identified}`, async () => {
      await withListener((origin, events) =>
        withNegotiatedConnection(
          origin,
          (hello) =>
            identified
              ? hello
              : {
                  ...hello,
                  protocol: { major: 2, minor: 3, minimumSupportedMinor: 0 },
                  capabilities: hello.capabilities.filter(
                    (capability) => capability.name !== "repository-ref-events",
                  ),
                },
          async (connection) => {
            const changed = vi.fn();
            const unsubscribe = connection.subscribeChanges(changed);
            try {
              events.publishChanged([environmentId]);
              await Effect.runPromise(connection.waitForSequence(1));
              expect(changed).toHaveBeenCalledExactlyOnceWith(
                identified ? [environmentId] : undefined,
              );
              unsubscribe();
              events.publishChanged([environmentId]);
              await Effect.runPromise(connection.waitForSequence(2));
              expect(changed).toHaveBeenCalledOnce();
            } finally {
              unsubscribe();
            }
          },
        ),
      );
    });

  it("discovers, negotiates, and snapshots one Environment", async () => {
    await withListener((origin, events) =>
      withCurrentConnection(origin, {}, async (connection) => {
        expect(connection.negotiated).toMatchObject({
          _tag: "HelloAccepted",
          accessCapabilities: ["environment.read"],
          environmentId,
        });

        await expect(
          Effect.runPromise(
            fetchEnvironmentSnapshotEffect(
              origin,
              connection.discovery,
              credential,
            ),
          ),
        ).resolves.toEqual({ environmentId, sequence: 0 });

        const changed = Effect.runPromise(connection.waitForSequence(1));
        events.publishChanged();
        await expect(changed).resolves.toBe(1);
        connection.close();
        await expect(Effect.runPromise(connection.closed)).resolves.toEqual(
          closedByClient,
        );
        await expect(
          Effect.runPromise(connection.waitForSequence(2)),
        ).rejects.toEqual(closedByClient);
      }),
    );
  });

  it("fetches a fresh snapshot after reconnecting across a sequence gap", async () => {
    await withListener(async (origin, events) => {
      await withCurrentConnection(origin, {}, async () => undefined);
      events.publishChanged();
      events.publishChanged();

      await withCurrentConnection(
        origin,
        { lastObservedSequence: 0 },
        async (recovered) => {
          events.publishChanged();
          await expect(
            Effect.runPromise(recovered.waitForSequence(3)),
          ).resolves.toBe(3);
          expect(recovered.currentSequence()).toBe(3);

          const resumed = Effect.runPromise(recovered.waitForSequence(4));
          events.publishChanged();
          await expect(resumed).resolves.toBe(4);
        },
      );
    });
  });

  it("closes the connection when its scope ends", async () => {
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

      await expect(Effect.runPromise(closed)).resolves.toEqual(closedByClient);
    });
  });

  it("resets the observed sequence after a server restart", async () => {
    await withListener((origin, events) =>
      withCurrentConnection(
        origin,
        { lastObservedSequence: 12 },
        async (connection) => {
          expect(connection.currentSequence()).toBe(0);
          events.publishChanged();
          expect(await Effect.runPromise(connection.waitForSequence(1))).toBe(
            1,
          );
        },
      ),
    );
  });

  it("exposes a tagged protocol rejection", async () => {
    await withListener(async (origin) => {
      await expect(
        withNegotiatedConnection(
          origin,
          (hello) => ({
            ...hello,
            protocol: { major: 3, minor: 0, minimumSupportedMinor: 0 },
          }),
          async () => undefined,
        ),
      ).rejects.toEqual(
        new EnvironmentHelloRejected({
          failure: {
            _tag: "ProtocolMajorMismatch",
            clientMajor: 3,
            requiredUpdate: "server",
            serverMajor: 2,
          },
        }),
      );
    });
  });

  it("uses the server baseline when resnapshot was not negotiated", async () => {
    await withListener((origin, events) =>
      withNegotiatedConnection(
        origin,
        () => ({
          ...createCurrentEnvironmentHello("0.0.0", 12),
          capabilities: [
            {
              introducedInMinor: 0,
              name: "environment-events",
              version: 1,
            },
          ],
          protocol: { major: 2, minor: 0, minimumSupportedMinor: 0 },
        }),
        async (connection) => {
          expect(connection.currentSequence()).toBe(0);

          const changed = Effect.runPromise(connection.waitForSequence(1));
          events.publishChanged();
          await expect(changed).resolves.toBe(1);
        },
      ),
    );
  });
});

function withCurrentConnection(
  origin: string,
  options: { readonly lastObservedSequence?: number },
  run: (connection: EnvironmentProtocolConnection) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      connectCurrentEnvironmentEffect(origin, "0.0.0", {
        credential,
        ...options,
      }).pipe(
        Effect.flatMap((connection) => Effect.promise(() => run(connection))),
      ),
    ),
  );
}

function withNegotiatedConnection(
  origin: string,
  hello: (current: EnvironmentHello) => EnvironmentHello,
  run: (connection: EnvironmentProtocolConnection) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const discovery = yield* fetchEnvironmentDiscoveryEffect(origin);
        const connection = yield* connectEnvironmentEffect(
          origin,
          discovery,
          hello(createCurrentEnvironmentHello("0.0.0")),
          credential,
        );
        yield* Effect.promise(() => run(connection));
      }),
    ),
  );
}

function withListener(
  run: (origin: string, events: EnvironmentEventPublisher) => Promise<void>,
  events = createEnvironmentEventPublisher(),
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const listener = yield* acquireEnvironmentListener({
          authorization: testAuthorization,
          environmentId,
          events,
          features: [environmentAuthorizationFeature(testAuthorization)],
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
