import {
  createCurrentEnvironmentHello,
  type EnvironmentHello,
} from "@rebase/contracts";
import {
  EnvironmentHelloRejected,
  EnvironmentResponseError,
  fetchEnvironmentDiscoveryEffect,
  fetchEnvironmentSnapshotEffect,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { openTestServer } from "#tests-support/server";
import {
  connectCurrentEnvironmentEffect,
  connectEnvironmentEffect,
  type EnvironmentProtocolConnection,
} from "#web/app/environment/connection/environment-protocol-client";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const closedByClient = new EnvironmentResponseError({
  responseTag: "WebSocket",
});

describe("browser Environment protocol client", () => {
  it("invalidates all refs after a sequence gap and resumes targeted changes without replaying duplicates", async () => {
    const server = await openTestServer({
      events: (events) => ({
        ...events,
        subscribe: (listener) =>
          events.subscribe((sequence, repositoryIds, kind) => {
            if (sequence === 1) return;
            listener(sequence, repositoryIds, kind);
            listener(sequence, repositoryIds, kind);
          }),
      }),
    });
    const { events } = server;
    await withCurrentConnection(server, {}, async (connection) => {
      const changed = vi.fn();
      const unsubscribe = connection.subscribeChanges(changed);
      try {
        events.publishChanged([repositoryId]);
        events.publishChanged([repositoryId]);
        await Effect.runPromise(connection.waitForSequence(2));
        expect(changed).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
        events.publishChanged([repositoryId], "Refs");
        events.publishChanged([repositoryId], "Refs");
        await Effect.runPromise(connection.waitForSequence(4));
        expect(changed.mock.calls).toEqual([
          [undefined, undefined],
          [[repositoryId], "Refs"],
          [[repositoryId], "Refs"],
        ]);
      } finally {
        unsubscribe();
      }
    });
  });

  for (const identified of [true, false])
    it(`delivers repository changes with identity negotiation ${identified}`, async () => {
      const server = await openTestServer();
      const { events } = server;
      await withNegotiatedConnection(
        server,
        (hello) =>
          identified
            ? hello
            : {
                ...hello,
                protocol: { major: 3, minor: 0, minimumSupportedMinor: 0 },
                capabilities: hello.capabilities.filter(
                  (capability) => capability.name !== "repository-ref-events",
                ),
              },
        async (connection) => {
          const changed = vi.fn();
          const unsubscribe = connection.subscribeChanges(changed);
          try {
            events.publishChanged([repositoryId], "Index");
            await Effect.runPromise(connection.waitForSequence(1));
            expect(changed).toHaveBeenCalledExactlyOnceWith(
              ...(identified
                ? [[repositoryId], "Index"]
                : [undefined, undefined]),
            );
            unsubscribe();
            events.publishChanged([repositoryId]);
            await Effect.runPromise(connection.waitForSequence(2));
            expect(changed).toHaveBeenCalledOnce();
          } finally {
            unsubscribe();
          }
        },
      );
    });

  it("discovers, negotiates, and snapshots one Environment", async () => {
    const server = await openTestServer();
    const { environmentId, events, origin, owner } = server;
    await withCurrentConnection(server, {}, async (connection) => {
      expect(connection.negotiated).toMatchObject({
        _tag: "HelloAccepted",
        environmentId,
      });

      await expect(
        Effect.runPromise(
          fetchEnvironmentSnapshotEffect(origin, connection.discovery, owner),
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
    });
  });

  it("fetches a fresh snapshot after reconnecting across a sequence gap", async () => {
    const server = await openTestServer();
    const { events } = server;
    await withCurrentConnection(server, {}, async () => undefined);
    events.publishChanged();
    events.publishChanged();

    await withCurrentConnection(
      server,
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

  it("closes the connection when its scope ends", async () => {
    const { origin, owner } = await openTestServer();
    const closed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* connectCurrentEnvironmentEffect(
            origin,
            "0.0.0",
            { credential: owner },
          );
          return connection.closed;
        }),
      ),
    );

    await expect(Effect.runPromise(closed)).resolves.toEqual(closedByClient);
  });

  it("resets the observed sequence after a server restart", async () => {
    const server = await openTestServer();
    const { events } = server;
    await withCurrentConnection(
      server,
      { lastObservedSequence: 12 },
      async (connection) => {
        expect(connection.currentSequence()).toBe(0);
        events.publishChanged();
        expect(await Effect.runPromise(connection.waitForSequence(1))).toBe(1);
      },
    );
  });

  it("exposes a tagged protocol rejection", async () => {
    const server = await openTestServer();
    await expect(
      withNegotiatedConnection(
        server,
        (hello) => ({
          ...hello,
          protocol: { major: 4, minor: 0, minimumSupportedMinor: 0 },
        }),
        async () => undefined,
      ),
    ).rejects.toEqual(
      new EnvironmentHelloRejected({
        failure: {
          _tag: "ProtocolMajorMismatch",
          clientMajor: 4,
          requiredUpdate: "server",
          serverMajor: 3,
        },
      }),
    );
  });

  it("uses the server baseline when resnapshot was not negotiated", async () => {
    const server = await openTestServer();
    const { events } = server;
    await withNegotiatedConnection(
      server,
      () => ({
        ...createCurrentEnvironmentHello("0.0.0", 12),
        capabilities: [
          {
            introducedInMinor: 0,
            name: "environment-events",
            version: 1,
          },
        ],
        protocol: { major: 3, minor: 0, minimumSupportedMinor: 0 },
      }),
      async (connection) => {
        expect(connection.currentSequence()).toBe(0);

        const changed = Effect.runPromise(connection.waitForSequence(1));
        events.publishChanged();
        await expect(changed).resolves.toBe(1);
      },
    );
  });
});

interface TestServer {
  readonly origin: string;
  readonly owner: { readonly type: "bearer"; readonly value: string };
}

function withCurrentConnection(
  server: TestServer,
  options: { readonly lastObservedSequence?: number },
  run: (connection: EnvironmentProtocolConnection) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      connectCurrentEnvironmentEffect(server.origin, "0.0.0", {
        credential: server.owner,
        ...options,
      }).pipe(
        Effect.flatMap((connection) => Effect.promise(() => run(connection))),
      ),
    ),
  );
}

function withNegotiatedConnection(
  server: TestServer,
  hello: (current: EnvironmentHello) => EnvironmentHello,
  run: (connection: EnvironmentProtocolConnection) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const discovery = yield* fetchEnvironmentDiscoveryEffect(server.origin);
        const connection = yield* connectEnvironmentEffect(
          server.origin,
          discovery,
          hello(createCurrentEnvironmentHello("0.0.0")),
          server.owner,
        );
        yield* Effect.promise(() => run(connection));
      }),
    ),
  );
}
