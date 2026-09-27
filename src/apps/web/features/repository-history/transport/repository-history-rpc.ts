import type {
  EnvironmentRpcClient,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import { Effect, Stream } from "effect";
import type { RpcClientError } from "effect/unstable/rpc";
import {
  createEnvironmentRequestId,
  RepositoryHistoryOffline,
  RepositoryHistoryRejected,
  type RepositoryHistoryTransport,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader";
import { createHistorySyncScheduler } from "#web/features/repository-history/transport/history-sync-scheduler";

const encoder = new TextEncoder();

export function createRepositoryHistoryRpc(
  client: EnvironmentRpcClient,
): RepositoryHistoryTransport {
  const schedule = createHistorySyncScheduler();
  return {
    freshness: {
      observe: (repositoryId, publish) =>
        client.WatchFreshness({ repositoryId }, { streamBufferSize: 1 }).pipe(
          Stream.mapError(historyRpcFailure),
          Stream.runForEach((state) => Effect.sync(() => publish(state))),
          Effect.andThen(Effect.fail(new RepositoryHistoryUnavailable())),
        ),
      fetch: (repositoryId) =>
        client
          .FetchHistory({ repositoryId })
          .pipe(Effect.mapError(historyRpcFailure)),
      configure: (repositoryId, setting) =>
        client
          .ConfigureFetch({ repositoryId, setting })
          .pipe(Effect.mapError(historyRpcFailure)),
    },
    read: (request) =>
      client
        .ReadHistory({
          ...request,
          _tag: "ReadRepositoryHistory",
          requestId: createEnvironmentRequestId(),
        })
        .pipe(
          Effect.map((json) => encoder.encode(json)),
          Effect.mapError(historyRpcFailure),
        ),
    synchronize: (request, acceptBatch) =>
      schedule(
        request.priority,
        Effect.gen(function* () {
          let commitCount: number | undefined;
          yield* client
            .SynchronizeHistory(
              {
                ...request,
                _tag: "SynchronizeRepositoryHistory",
                requestId: createEnvironmentRequestId(),
              },
              { streamBufferSize: 1 },
            )
            .pipe(
              Stream.mapError(historyRpcFailure),
              Stream.runForEach((message) => {
                if (typeof message !== "string")
                  return Effect.sync(() => {
                    commitCount = message.commitCount;
                  });
                return acceptBatch(encoder.encode(message));
              }),
            );
          if (commitCount === undefined)
            return yield* new RepositoryHistoryUnavailable();
          return commitCount;
        }),
      ),
  };
}

function historyRpcFailure(
  error: RepositoryHistoryOperationFailure | RpcClientError.RpcClientError,
) {
  return error._tag === "RpcClientError"
    ? new RepositoryHistoryOffline()
    : new RepositoryHistoryRejected({ failure: error });
}
