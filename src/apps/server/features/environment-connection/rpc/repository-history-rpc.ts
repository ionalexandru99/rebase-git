import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  fragmentJsonMessage,
  type JsonMessageFragment,
  type ReadRepositoryHistory,
  type RepositoryHistoryOperationFailure,
  type RepositoryHistorySynchronized,
  type SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { type Cause, Deferred, Effect, Queue, Stream } from "effect";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import type { EnvironmentRpcSession } from "#server/features/environment-connection/rpc/environment-rpc-session.contract";

type HistoryOutput = JsonMessageFragment | RepositoryHistorySynchronized;
interface PendingBatch {
  readonly sequence: number;
  readonly committed: Deferred.Deferred<void>;
}

export function repositoryHistoryRpc(session: EnvironmentRpcSession) {
  const requests = new Set<string>();
  const pending = new Map<string, PendingBatch>();
  const acquire = (requestId: string) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const negotiated = yield* session.requireCapability(
          "repository-history",
          "repository.read",
        );
        if (
          session.state.history === undefined ||
          requests.size >= 2 ||
          requests.has(requestId)
        )
          return yield* failed();
        requests.add(requestId);
        return {
          history: session.state.history,
          limit: negotiated.limits.maxWebSocketResponseBytes - 512,
        };
      }),
      () =>
        Effect.sync(() => {
          requests.delete(requestId);
          pending.delete(requestId);
        }),
    );

  return {
    ReadHistory: (request: ReadRepositoryHistory) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { history, limit } = yield* acquire(request.requestId);
          const page = yield* history
            .read(request)
            .pipe(Effect.mapError(historyFailure));
          const fragments = yield* Effect.try({
            try: () =>
              fragmentJsonMessage(
                {
                  payload: encodeRepositoryHistoryPage(page),
                  requestId: request.requestId,
                  logicalMessageId: 0,
                },
                limit,
              ),
            catch: () => failure(),
          });
          return Stream.fromIterable(fragments).pipe(Stream.rechunk(1));
        }),
      ),
    SynchronizeHistory: (request: SynchronizeRepositoryHistory) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const { history, limit } = yield* acquire(request.requestId);
          const queue = yield* Queue.bounded<
            HistoryOutput,
            RepositoryHistoryOperationFailure | Cause.Done
          >(1);
          yield* Effect.addFinalizer(() => Queue.shutdown(queue));
          const produce = history
            .synchronize(request, (batch) =>
              Effect.gen(function* () {
                const committed = yield* Deferred.make<void>();
                pending.set(request.requestId, {
                  sequence: batch.sequence,
                  committed,
                });
                const fragments = yield* Effect.try({
                  try: () =>
                    fragmentJsonMessage(
                      {
                        payload: encodeRepositoryHistoryBatch(batch),
                        requestId: request.requestId,
                        logicalMessageId: batch.sequence,
                      },
                      limit,
                    ),
                  catch: () =>
                    new RepositoryHistoryError({ failure: failure() }),
                });
                yield* Queue.offerAll(queue, fragments);
                yield* Deferred.await(committed).pipe(
                  Effect.timeoutOrElse({
                    duration: "30 seconds",
                    orElse: () =>
                      Effect.fail(
                        new RepositoryHistoryError({ failure: failure() }),
                      ),
                  }),
                );
                pending.delete(request.requestId);
              }),
            )
            .pipe(
              Effect.mapError(historyFailure),
              Effect.flatMap((commitCount) =>
                Queue.offer(queue, {
                  _tag: "RepositoryHistorySynchronized",
                  commitCount,
                  requestId: request.requestId,
                }),
              ),
              Effect.andThen(Queue.end(queue)),
              Effect.catchCause((cause) => Queue.failCause(queue, cause)),
            );
          yield* Effect.forkScoped(produce);
          return Stream.fromQueue(queue).pipe(Stream.rechunk(1));
        }),
      ),
    CommitHistoryBatch: ({
      requestId,
      sequence,
    }: {
      requestId: string;
      sequence: number;
    }) =>
      Effect.gen(function* () {
        yield* session.requireCapability(
          "repository-history",
          "repository.read",
        );
        const batch = pending.get(requestId);
        if (batch === undefined || batch.sequence !== sequence)
          return yield* failed();
        yield* Deferred.succeed(batch.committed, undefined);
      }),
  };
}

function failure(): RepositoryHistoryOperationFailure {
  return { _tag: "GitFailed", reason: "Failed" };
}

function failed() {
  return Effect.fail(failure());
}

function historyFailure(error: {
  readonly _tag: string;
  readonly failure?: RepositoryHistoryOperationFailure;
}): RepositoryHistoryOperationFailure {
  return error.failure ?? failure();
}
