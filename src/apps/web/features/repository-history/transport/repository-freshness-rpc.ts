import type { EnvironmentRpcClient } from "@rebase/contracts/environment-connection/rpc/environment-rpc.contract";
import { Effect, Stream } from "effect";
import { RepositoryHistoryUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryFreshnessTransport } from "#web/features/repository-history/transport/repository-freshness.contract";
import { historyRpcFailure } from "#web/features/repository-history/transport/repository-history-rpc-error";

export function createRepositoryFreshnessRpc(
  client: EnvironmentRpcClient,
  enabled: boolean,
): RepositoryFreshnessTransport {
  return {
    observe: (repositoryId, publish) =>
      Effect.gen(function* () {
        if (!enabled) return yield* new RepositoryHistoryUnavailable();
        yield* client
          .WatchFreshness({ repositoryId }, { streamBufferSize: 1 })
          .pipe(
            Stream.mapError(historyRpcFailure),
            Stream.runForEach((state) => Effect.sync(() => publish(state))),
          );
        return yield* new RepositoryHistoryUnavailable();
      }),
    fetch: (repositoryId) =>
      Effect.gen(function* () {
        if (!enabled) return yield* new RepositoryHistoryUnavailable();
        return yield* client
          .FetchHistory({ repositoryId })
          .pipe(Effect.mapError(historyRpcFailure));
      }),
    configure: (repositoryId, setting) =>
      Effect.gen(function* () {
        if (!enabled) return yield* new RepositoryHistoryUnavailable();
        return yield* client
          .ConfigureFetch({ repositoryId, setting })
          .pipe(Effect.mapError(historyRpcFailure));
      }),
  };
}
