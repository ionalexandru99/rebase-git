import { Effect, Fiber } from "effect";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/repository-history-worker.contract";
import { searchStoredRepositoryHistory } from "#web/features/repository-history/search/repository-history-search";
import type { ConnectedReader } from "#web/features/repository-history/worker/history-worker.contract";
import {
  post,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";

export function cancelReaderSearch(reader: ConnectedReader) {
  if (reader.search !== undefined)
    Effect.runFork(Fiber.interrupt(reader.search.fiber));
}

export function searchHistory(
  reader: ConnectedReader,
  message: Extract<RepositoryHistoryWorkerRequest, { _tag: "SearchHistory" }>,
) {
  cancelReaderSearch(reader);
  const operation = Effect.tryPromise({
    try: (signal) =>
      searchStoredRepositoryHistory(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        signal,
      ),
    catch: workerFailure,
  }).pipe(
    Effect.tap((result) =>
      Effect.sync(() =>
        post(reader, {
          _tag: "HistorySearchResult",
          result,
          requestId: message.requestId,
        }),
      ),
    ),
    Effect.catch((failure) =>
      Effect.sync(() =>
        post(reader, {
          _tag: "RequestFailed",
          failure,
          requestId: message.requestId,
        }),
      ),
    ),
    Effect.onInterrupt(() =>
      Effect.sync(() =>
        post(reader, {
          _tag: "HistorySearchCanceled",
          requestId: message.requestId,
        }),
      ),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        if (reader.search?.requestId === message.requestId)
          delete reader.search;
      }),
    ),
    Effect.asVoid,
  );
  reader.search = {
    requestId: message.requestId,
    fiber: Effect.runSync(Effect.forkIn(operation, reader.scope)),
  };
}
