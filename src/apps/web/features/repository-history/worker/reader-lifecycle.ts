import { Effect, Exit, Scope } from "effect";
import { isHistoryStorageQuotaError } from "#web/features/repository-history/cache/repository-history-storage-policy";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/reader/repository-history-epoch";
import { watchRepositoryHistoryReaderLease } from "#web/features/repository-history/reader/repository-history-reader-lease";
import {
  assignFreshnessOwner,
  closeFreshness,
} from "#web/features/repository-history/worker/freshness-lifecycle";
import type {
  ConnectedReader,
  ReaderMessageHandler,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import {
  post,
  postSnapshot,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerRequest,
} from "#web/features/repository-history/worker/repository-history-worker.contract";
import {
  createReplica,
  repositories,
} from "#web/features/repository-history/worker/repository-replicas";
import {
  cancelSynchronization,
  startSynchronization,
} from "#web/features/repository-history/worker/synchronization";
import {
  activeSynchronization,
  settleSynchronization,
} from "#web/features/repository-history/worker/synchronization-state";

export function connectReader(
  connection: ConnectRepositoryHistoryReader,
  handleReaderMessage: ReaderMessageHandler,
  cachePaused = false,
) {
  const key = `${connection.environmentId}\0${connection.logicalRepositoryId}`;
  const existing = repositories.get(key);
  const replica =
    existing ??
    createReplica(connection.environmentId, connection.logicalRepositoryId);
  if (cachePaused || (existing === undefined && connection.cachePaused))
    replica.cachePaused = true;
  const reader: ConnectedReader = {
    closed: false,
    connection,
    epoch: new RepositoryHistoryEpoch(),
    queries: new Map(),
    scope: Scope.makeUnsafe(),
    stopWatchingLease: () => undefined,
  };
  replica.readers.add(reader);
  repositories.set(key, replica);
  reader.stopWatchingLease = watchRepositoryHistoryReaderLease(
    connection.lifetimeLock,
    () => closeReader(reader, replica),
  );
  connection.port.onmessage = (
    event: MessageEvent<RepositoryHistoryWorkerRequest>,
  ) => {
    void handleReaderMessage(reader, replica, event.data).catch((error) =>
      reportReaderFailure(reader, replica, event.data, error),
    );
  };
  connection.port.start();
  postSnapshot(reader, replica);
  assignFreshnessOwner(replica);
}

function reportReaderFailure(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
  error: unknown,
) {
  if (reader.closed) return;
  const failure = workerFailure(error);
  if (message._tag === "HistoryBatchReceived") {
    const active = activeSynchronization(replica, reader, message.requestId);
    if (active !== undefined) {
      settleSynchronization(replica, active, false);
      replica.failure = failure;
      replica.storageExhausted = isHistoryStorageQuotaError(error);
      replica.revision += 1;
      publishSnapshot(replica);
    }
    post(reader, {
      _tag: "HistoryBatchFailed",
      batchId: message.batchId,
      failure,
    });
    return;
  }
  if (!("requestId" in message)) return;
  replica.failure = failure;
  replica.status = "error";
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, {
    _tag: "RequestFailed",
    failure,
    requestId: message.requestId,
  });
}

export function closeReader(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (reader.closed) return;
  reader.stopWatchingLease();
  const activeRequestId = reader.epoch.cancel();
  if (activeRequestId !== undefined) {
    post(reader, {
      _tag: "CancelHistoryLoad",
      requestId: activeRequestId,
    });
  }
  replica.readers.delete(reader);
  closeFreshness(reader, replica);
  const ownedSynchronization =
    replica.synchronization.status === "syncing" &&
    replica.synchronization.owner === reader;
  if (ownedSynchronization) {
    cancelSynchronization(reader, replica);
  }
  reader.closed = true;
  Effect.runFork(Scope.close(reader.scope, Exit.void));
  if (replica.readers.size === 0) {
    replica.orderCache.revision += 1;
    delete replica.orderCache.index;
    replica.orderCache.queries.clear();
    repositories.delete(
      `${reader.connection.environmentId}\0${reader.connection.logicalRepositoryId}`,
    );
  } else if (
    ownedSynchronization &&
    replica.synchronization.status !== "complete"
  ) {
    const replacement = replica.readers.values().next().value;
    if (replacement !== undefined) {
      void startSynchronization(replacement, replica).catch((error) => {
        replica.failure = workerFailure(error);
        replica.revision += 1;
        publishSnapshot(replica);
      });
    }
  }
  reader.connection.port.close();
  reader.connection.port.onmessage = null;
  reader.queries.clear();
}
