import { readRepositoryHistoryBatchSequence } from "@rebase/contracts";
import type { EnvironmentRpcClient } from "@rebase/contracts/environment-connection/rpc/environment-rpc.contract";
import { Effect, Option, Stream } from "effect";
import { environmentResponseError } from "#web/features/environment-connection/environment-connection-errors";
import { rpcJsonReassembler } from "#web/features/environment-connection/rpc/environment-rpc-json";
import { createEnvironmentRequestId } from "#web/features/environment-connection/websocket/environment-request-id";
import {
  type RepositoryHistoryTransport,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { createHistorySyncScheduler } from "#web/features/repository-history/transport/history-sync-scheduler";
import { createRepositoryFreshnessRpc } from "#web/features/repository-history/transport/repository-freshness-rpc";
import { historyRpcFailure } from "#web/features/repository-history/transport/repository-history-rpc-error";

export function createRepositoryHistoryRpc(
  client: EnvironmentRpcClient,
  enabled: boolean,
  freshnessEnabled: boolean,
): RepositoryHistoryTransport {
  const schedule = createHistorySyncScheduler();
  return {
    freshness: createRepositoryFreshnessRpc(client, freshnessEnabled),
    read: (request) =>
      Effect.gen(function* () {
        if (!enabled) return yield* new RepositoryHistoryUnavailable();
        const requestId = createEnvironmentRequestId();
        const accept = rpcJsonReassembler(requestId);
        const result = yield* client
          .ReadHistory(
            { ...request, _tag: "ReadRepositoryHistory", requestId },
            { streamBufferSize: 1 },
          )
          .pipe(
            Stream.mapError(historyRpcFailure),
            Stream.mapEffect(accept),
            Stream.filter((bytes): bytes is Uint8Array => bytes !== undefined),
            Stream.runHead,
          );
        if (Option.isNone(result))
          return yield* new RepositoryHistoryUnavailable();
        return result.value;
      }),
    synchronize: (request, acceptBatch) =>
      schedule(
        request.priority,
        Effect.gen(function* () {
          if (!enabled) return yield* new RepositoryHistoryUnavailable();
          const requestId = createEnvironmentRequestId();
          const accept = rpcJsonReassembler(requestId);
          let expectedSequence =
            request.basis?._tag === "Incomplete"
              ? request.basis.nextBatchSequence
              : 0;
          let commitCount: number | undefined;
          yield* client
            .SynchronizeHistory(
              { ...request, _tag: "SynchronizeRepositoryHistory", requestId },
              { streamBufferSize: 1 },
            )
            .pipe(
              Stream.mapError(historyRpcFailure),
              Stream.takeUntil(
                (message) => message._tag === "RepositoryHistorySynchronized",
              ),
              Stream.runForEach((message) =>
                Effect.gen(function* () {
                  if (commitCount !== undefined)
                    return yield* environmentResponseError("WebSocket");
                  if (message._tag === "RepositoryHistorySynchronized") {
                    commitCount = message.commitCount;
                    return;
                  }
                  const bytes = yield* accept(message);
                  if (bytes === undefined) return;
                  const sequence = yield* Effect.try({
                    try: () => readRepositoryHistoryBatchSequence(bytes),
                    catch: () => environmentResponseError("WebSocket"),
                  });
                  if (sequence !== expectedSequence)
                    return yield* environmentResponseError("WebSocket");
                  yield* acceptBatch(bytes);
                  yield* client
                    .CommitHistoryBatch({
                      _tag: "AcknowledgeRepositoryHistoryBatch",
                      requestId,
                      sequence,
                    })
                    .pipe(Effect.mapError(historyRpcFailure));
                  expectedSequence += 1;
                }),
              ),
            );
          if (commitCount === undefined)
            return yield* new RepositoryHistoryUnavailable();
          return commitCount;
        }),
      ),
  };
}
