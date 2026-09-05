import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import type {
  RepositoryHistoryWorkerFailure,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";

export function publishSnapshot(replica: RepositoryReplica) {
  for (const reader of replica.readers) {
    postSnapshot(reader, replica);
  }
}

export function postSnapshot(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  post(reader, {
    _tag: "SnapshotChanged",
    shallowOids: replica.shallowOids,
    ...(replica.freshness === undefined
      ? {}
      : { freshness: replica.freshness }),
    ...(replica.freshnessFailure === undefined
      ? {}
      : { freshnessFailure: replica.freshnessFailure }),
    storingCommits:
      replica.synchronization.status === "syncing" &&
      replica.synchronization.storingCommits,
    cachePaused: replica.cachePaused ?? false,
    ...(replica.failure === undefined ? {} : { failure: replica.failure }),
    revision: replica.revision,
    historyRevision: replica.orderCache.revision,
    status: replica.status,
    synchronization: replica.synchronization.status,
    synchronizedCommitCount: replica.synchronizedCommitCount,
  });
}

export function post(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerResponse,
) {
  if (!reader.closed) {
    reader.connection.port.postMessage(message);
  }
}

export function workerFailure(error: unknown): RepositoryHistoryWorkerFailure {
  return error instanceof RepositoryHistoryStorageUnavailable
    ? { _tag: "StorageUnavailable" }
    : { _tag: "Unavailable" };
}

export function invalidateStoredHistory(
  replica: RepositoryReplica,
  discardOrder = false,
) {
  replica.orderCache.revision += 1;
  delete replica.orderCache.index;
  if (discardOrder) replica.orderCache.queries.clear();
}
