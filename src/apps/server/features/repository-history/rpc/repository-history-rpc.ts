import {
  type ReadRepositoryHistory,
  type RepositoryHistoryOperationFailure,
  type RepositoryHistoryRpc,
  type RepositoryHistorySynchronized,
  repositoryHistoryBatchJson,
  repositoryHistoryPageJson,
  type SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { type Cause, Effect, Queue, Stream } from "effect";
import type { EnvironmentRpcHandlersFor } from "#server/adapters/environment-transport/environment-routes";
import type { RepositoryHistoryService } from "#server/features/repository-history/repository-history";

type HistoryOutput = string | RepositoryHistorySynchronized;
type HistoryReadHandlers = Pick<
  EnvironmentRpcHandlersFor<typeof RepositoryHistoryRpc>,
  "ReadHistory" | "SynchronizeHistory"
>;

export function repositoryHistoryRpc(
  history: RepositoryHistoryService,
): HistoryReadHandlers {
  const requests = new Set<string>();
  const acquire = (requestId: string) =>
    Effect.acquireRelease(
      Effect.suspend(() => {
        if (requests.size >= 2 || requests.has(requestId)) return failed();
        requests.add(requestId);
        return Effect.void;
      }),
      () =>
        Effect.sync(() => {
          requests.delete(requestId);
        }),
    );

  return {
    ReadHistory: (request: ReadRepositoryHistory) =>
      Effect.scoped(
        acquire(request.requestId).pipe(
          Effect.andThen(history.read(request)),
          Effect.map(repositoryHistoryPageJson),
        ),
      ),
    SynchronizeHistory: (request: SynchronizeRepositoryHistory) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* acquire(request.requestId);
          const queue = yield* Queue.bounded<
            HistoryOutput,
            RepositoryHistoryOperationFailure | Cause.Done
          >(1);
          yield* Effect.addFinalizer(() => Queue.shutdown(queue));
          const produce = history
            .synchronize(request, (batch) =>
              Queue.offer(queue, repositoryHistoryBatchJson(batch)).pipe(
                Effect.asVoid,
              ),
            )
            .pipe(
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
          return Stream.fromQueue(queue);
        }),
      ),
  };
}

function failed() {
  return Effect.fail<RepositoryHistoryOperationFailure>({
    _tag: "GitFailed",
    reason: "Failed",
  });
}
