import { randomUUID } from "node:crypto";
import {
  createCurrentEnvironmentHello,
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type EnvironmentAccessCapability,
  type RepositoryHistoryBatch,
} from "@rebase/contracts";
import {
  connectEnvironmentEffect,
  fetchEnvironmentDiscovery,
} from "@rebase/web/features/environment-connection";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const oid = "a".repeat(40);
const query = {
  repositoryId,
  order: "topological" as const,
  limit: 100,
  roots: [{ name: "main", oid, type: "branch" as const }],
};
const identity = {
  name: "Alex",
  email: "alex@example.test",
  timestampSeconds: 0,
  timezoneOffsetMinutes: 0,
};

describe("Effect RPC over WebSockets", () => {
  it("streams a large history page within the negotiated frame limit", () =>
    withHistory(
      {
        read: (request) =>
          Effect.succeed({
            objectFormat: "sha1",
            repositoryId,
            requestId: request.requestId,
            refTargets: [],
            commits: [
              {
                oid,
                parents: [],
                author: identity,
                committer: identity,
                subject: 'long "message" 😀'.repeat(4_000),
              },
            ],
          }),
        synchronize: () => Effect.die("unused"),
      },
      (connection) =>
        Effect.gen(function* () {
          const page = decodeRepositoryHistoryPage(
            yield* connection.repositoryHistory.read(query),
          );
          expect(page.commits[0]?.subject).toBe(
            'long "message" 😀'.repeat(4_000),
          );
        }),
    ));

  it("waits for browser storage before finishing synchronization", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const received = yield* Deferred.make<void>();
        const stored = yield* Deferred.make<void>();
        let finished = false;
        yield* historyConnection(
          {
            read: () => Effect.die("unused"),
            synchronize: (request, emit) =>
              emit(batch(request.requestId)).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    finished = true;
                    return 1;
                  }),
                ),
              ),
          },
          (connection) =>
            Effect.gen(function* () {
              const sync = yield* connection.repositoryHistory
                .synchronize({ repositoryId, priority: "visible" }, (bytes) =>
                  Effect.gen(function* () {
                    expect(decodeRepositoryHistoryBatch(bytes).sequence).toBe(
                      0,
                    );
                    yield* Deferred.succeed(received, undefined);
                    yield* Deferred.await(stored);
                  }),
                )
                .pipe(Effect.forkScoped);
              yield* Deferred.await(received);
              expect(finished).toBe(false);
              yield* Deferred.succeed(stored, undefined);
              expect(yield* Fiber.join(sync)).toBe(1);
              expect(finished).toBe(true);
            }),
        );
      }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
    ));

  it("interrupts server work when a caller cancels, and keeps the connection usable", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const interrupted = yield* Deferred.make<void>();
        yield* historyConnection(
          {
            read: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(interrupted, undefined)),
              ),
            synchronize: () => Effect.succeed(0),
          },
          (connection) =>
            Effect.gen(function* () {
              const reading = yield* connection.repositoryHistory
                .read(query)
                .pipe(Effect.forkScoped);
              yield* Deferred.await(started);
              yield* Fiber.interrupt(reading);
              yield* Deferred.await(interrupted);
              expect(
                yield* connection.repositoryHistory.synchronize(
                  { repositoryId, priority: "visible" },
                  () => Effect.void,
                ),
              ).toBe(0);
            }),
        );
      }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
    ));

  it("bounds concurrent history reads on one connection", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const occupied = yield* Deferred.make<void>();
        let active = 0;
        yield* historyConnection(
          {
            read: () =>
              Effect.gen(function* () {
                active += 1;
                if (active === 2) yield* Deferred.succeed(occupied, undefined);
                return yield* Effect.never;
              }),
            synchronize: () => Effect.die("unused"),
          },
          (connection) =>
            Effect.gen(function* () {
              const first = yield* connection.repositoryHistory
                .read(query)
                .pipe(Effect.forkScoped);
              const second = yield* connection.repositoryHistory
                .read(query)
                .pipe(Effect.forkScoped);
              yield* Deferred.await(occupied);
              const failure = yield* connection.repositoryHistory
                .read(query)
                .pipe(Effect.flip);
              expect(failure).toMatchObject({
                _tag: "RepositoryHistoryRejected",
                failure: { _tag: "GitFailed" },
              });
              expect(active).toBe(2);
              yield* Fiber.interrupt(first);
              yield* Fiber.interrupt(second);
            }),
        );
      }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
    ));

  it("rejects history calls without repository access", () =>
    withHistory(
      {
        read: () => Effect.die("must not read"),
        synchronize: () => Effect.die("must not synchronize"),
      },
      (connection) =>
        connection.repositoryHistory.read(query).pipe(
          Effect.flip,
          Effect.tap((error) =>
            Effect.sync(() =>
              expect(error).toMatchObject({
                _tag: "RepositoryHistoryRejected",
                failure: { _tag: "AuthorizationDenied" },
              }),
            ),
          ),
        ),
      ["environment.read"],
    ));
});

function batch(requestId: string): RepositoryHistoryBatch {
  return {
    repositoryId,
    requestId,
    objectFormat: "sha1",
    sequence: 0,
    commits: [
      {
        oid,
        parents: [],
        author: identity,
        committer: identity,
        subject: "commit",
      },
    ],
  };
}

function withHistory<A, E>(
  history: RepositoryHistoryService,
  use: (connection: EnvironmentProtocolConnection) => Effect.Effect<A, E>,
  capabilities?: readonly EnvironmentAccessCapability[],
) {
  return Effect.runPromise(
    historyConnection(history, use, capabilities).pipe(
      Effect.scoped,
      Effect.timeout("5 seconds"),
    ),
  );
}

function historyConnection<A, E, R>(
  history: RepositoryHistoryService,
  use: (connection: EnvironmentProtocolConnection) => Effect.Effect<A, E, R>,
  capabilities: readonly EnvironmentAccessCapability[] = [
    "environment.read",
    "repository.read",
  ],
) {
  return Effect.gen(function* () {
    const authorization = {
      capabilities,
      id: randomUUID(),
      label: "Test",
      role: "custom" as const,
    };
    const auth: EnvironmentAuthorization = {
      authorize: () => Effect.succeed(authorization),
      consumeTicket: () => Effect.succeed(authorization),
      mintTicket: () =>
        Effect.succeed({
          ticket: "test-ticket-material-00000000000000000000",
          expiresAt: "2026-09-06T00:00:00.000Z",
        }),
      createPairing: () => Effect.die("unused"),
      exchangePairing: () => Effect.die("unused"),
      revoke: () => Effect.die("unused"),
    };
    const listener = yield* acquireEnvironmentListener({
      authorization: auth,
      environmentId: repositoryId,
      events: createEnvironmentEventPublisher(),
      history,
      productVersion: "0.0.0",
    });
    listener.readiness.value = true;
    const discovery = yield* Effect.promise(() =>
      fetchEnvironmentDiscovery(listener.origin),
    );
    const hello = createCurrentEnvironmentHello("0.0.0");
    const connection = yield* connectEnvironmentEffect(
      listener.origin,
      discovery,
      {
        ...hello,
        receiveLimits: {
          ...hello.receiveLimits,
          maxWebSocketResponseBytes: 4_096,
        },
      },
      { type: "bearer", value: "test" },
    );
    const result = yield* use(connection);
    return result;
  });
}
