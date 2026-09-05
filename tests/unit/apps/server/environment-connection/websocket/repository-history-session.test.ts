import type {
  BinaryLogicalMessage,
  EnvironmentServerMessage,
  ReadRepositoryHistory,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vite-plus/test";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import { acquireRepositoryHistorySession } from "#server/features/environment-connection/websocket/repository-history-session";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const synchronization: SynchronizeRepositoryHistory = {
  _tag: "SynchronizeRepositoryHistory",
  repositoryId,
  requestId: "sync",
  priority: "visible",
};
const page: ReadRepositoryHistory = {
  _tag: "ReadRepositoryHistory",
  repositoryId,
  requestId: "page",
  limit: 100,
  order: "topological",
  roots: [{ name: "main", oid: "a".repeat(40), type: "branch" }],
};

describe("repository history session", () => {
  it("interrupts page reads and acknowledgement waits when its scope closes", async () => {
    const fixture = createFixture();
    const pageReleased = vi.fn();
    const synchronizationReleased = vi.fn();
    fixture.history.read.mockReturnValue(
      Effect.never.pipe(Effect.ensuring(Effect.sync(pageReleased))),
    );
    fixture.history.synchronize.mockImplementation((request, emit) =>
      emit(batch(request.requestId)).pipe(
        Effect.as(0),
        Effect.ensuring(Effect.sync(synchronizationReleased)),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* acquire(fixture);
        yield* session.handle(page);
        yield* session.handle(synchronization);
        yield* Effect.yieldNow;
        expect(fixture.binary).toHaveLength(1);
        expect(pageReleased).not.toHaveBeenCalled();
        expect(synchronizationReleased).not.toHaveBeenCalled();
      }).pipe(Effect.scoped),
    );

    expect(pageReleased).toHaveBeenCalledOnce();
    expect(synchronizationReleased).toHaveBeenCalledOnce();
    expect(fixture.messages).toEqual([]);
  });

  it("keeps a reused request active when canceled work finishes cleaning up", async () => {
    const fixture = createFixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const cleanupStarted = yield* Deferred.make<void>();
        const finishCleanup = yield* Deferred.make<void>();
        fixture.history.synchronize.mockImplementationOnce((request, emit) =>
          emit(batch(request.requestId)).pipe(
            Effect.as(0),
            Effect.ensuring(
              Deferred.succeed(cleanupStarted, undefined).pipe(
                Effect.andThen(Deferred.await(finishCleanup)),
              ),
            ),
          ),
        );
        const session = yield* acquire(fixture);
        yield* session.handle(synchronization);
        yield* Effect.yieldNow;
        yield* session.handle({
          _tag: "CancelRepositoryHistory",
          requestId: "sync",
        });
        yield* Deferred.await(cleanupStarted);
        yield* session.handle({
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId: "sync",
          sequence: 0,
        });
        yield* session.handle(synchronization);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(finishCleanup, undefined);
        yield* Effect.yieldNow;
        yield* session.handle({ ...synchronization, requestId: "other" });
        expect(fixture.messages).toEqual([
          {
            _tag: "RepositoryHistoryFailed",
            requestId: "other",
            failure: {
              _tag: "GitFailed",
              reason: "Failed",
              detail: "A repository history synchronization is already running",
            },
          },
        ]);
        yield* session.handle({
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId: "sync",
          sequence: 0,
        });
        yield* Effect.yieldNow;
        expect(fixture.messages.at(-1)).toEqual({
          _tag: "RepositoryHistorySynchronized",
          requestId: "sync",
          commitCount: 0,
        });
        expect(
          fixture.binary.map((message) => message.logicalMessageId),
        ).toEqual([1, 2]);
      }).pipe(Effect.scoped),
    );
  });

  it("accepts repeated completed acknowledgements and rejects unsent sequences", async () => {
    const fixture = createFixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* acquire(fixture);
        yield* session.handle(synchronization);
        yield* Effect.yieldNow;
        const acknowledgement = {
          _tag: "AcknowledgeRepositoryHistoryBatch",
          requestId: "sync",
          sequence: 0,
        } as const;
        yield* session.handle(acknowledgement);
        yield* Effect.yieldNow;
        yield* session.handle(acknowledgement);
        expect(fixture.messages).toEqual([
          {
            _tag: "RepositoryHistorySynchronized",
            requestId: "sync",
            commitCount: 0,
          },
        ]);
        const result = yield* session
          .handle({ ...acknowledgement, sequence: 1 })
          .pipe(Effect.flip);
        expect(result).toMatchObject({
          _tag: "EnvironmentWebSocketSessionRejected",
          result: { failure: { _tag: "InvalidMessage" } },
        });
      }).pipe(Effect.scoped),
    );
  });

  it("fails a missing acknowledgement and frees the synchronization slot", async () => {
    const fixture = createFixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const session = yield* acquire(fixture);
        yield* session.handle(synchronization);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(30_000);
        expect(fixture.messages).toEqual([
          {
            _tag: "RepositoryHistoryFailed",
            requestId: "sync",
            failure: {
              _tag: "GitFailed",
              reason: "Failed",
              detail: "History batch acknowledgement failed",
            },
          },
        ]);
        yield* session.handle({ ...synchronization, requestId: "next" });
        yield* Effect.yieldNow;
        expect(fixture.binary.map((message) => message.requestId)).toEqual([
          "sync",
          "next",
        ]);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    );
  });
});

function batch(requestId: string) {
  return {
    commits: [],
    objectFormat: "sha1" as const,
    repositoryId,
    requestId,
    sequence: 0,
  };
}

function createFixture() {
  const messages: EnvironmentServerMessage[] = [];
  const binary: BinaryLogicalMessage[] = [];
  return {
    messages,
    binary,
    history: {
      read: vi.fn<RepositoryHistoryService["read"]>(() => Effect.never),
      synchronize: vi.fn<RepositoryHistoryService["synchronize"]>(
        (request, emit) => emit(batch(request.requestId)).pipe(Effect.as(0)),
      ),
    },
    writer: {
      send: (message: EnvironmentServerMessage) =>
        Effect.sync(() => {
          messages.push(message);
        }),
      sendBinary: (message: BinaryLogicalMessage) =>
        Effect.sync(() => {
          binary.push(message);
        }),
    },
  };
}

function acquire(fixture: ReturnType<typeof createFixture>) {
  return acquireRepositoryHistorySession(
    fixture.history,
    fixture.writer,
    new Set(["repository.read"]),
  );
}
