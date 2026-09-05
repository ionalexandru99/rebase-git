import { decodeRepositoryHistoryBatch } from "@rebase/contracts";
import { queueHistoryStorageWrite as queueStorageWrite } from "#web/features/repository-history/cache/repository-history-storage-maintenance";
import { prepareRepositoryHistoryOrder } from "#web/features/repository-history/query/repository-history-query";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  restartRepositoryHistorySynchronization,
  storeRepositoryHistoryBatch,
} from "#web/features/repository-history/replica/repository-history-store";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/transport/repository-history-request-id";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import {
  invalidateStoredHistory,
  post,
  publishSnapshot,
} from "#web/features/repository-history/worker/replica-state";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/worker/repository-history-worker.contract";
import { writeStoredHistory } from "#web/features/repository-history/worker/repository-replicas";
import {
  activeSynchronization,
  beginSynchronization,
  settleSynchronization,
} from "#web/features/repository-history/worker/synchronization-state";

export async function acceptHistoryBatch(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  batchId: string,
  bytes: Uint8Array,
) {
  const active = activeSynchronization(replica, reader, requestId);
  if (active === undefined) return;
  const batch = decodeRepositoryHistoryBatch(bytes);
  if (batch.repositoryId !== reader.connection.repositoryId)
    throw new Error("History batch identity does not match the reader");
  const synchronizedCommitCount = await writeStoredHistory(() =>
    replica.synchronization !== active
      ? Promise.resolve(replica.synchronizedCommitCount)
      : storeRepositoryHistoryBatch(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
          batch,
        ),
  );
  if (replica.synchronization !== active) return;
  replica.synchronizedCommitCount = synchronizedCommitCount;
  if (batch.commits.length > 0) {
    active.storingCommits = true;
    invalidateStoredHistory(replica);
  }
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "HistoryBatchCommitted", batchId });
}

export async function startSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (
    reader.closed ||
    replica.cachePaused ||
    replica.storageExhausted ||
    replica.synchronization.status === "syncing"
  )
    return;
  const requestId = createRepositoryHistoryRequestId();
  const active = beginSynchronization(replica, reader, requestId);
  replica.revision += 1;
  publishSnapshot(replica);
  let basis: Awaited<ReturnType<typeof beginRepositoryHistorySynchronization>>;
  try {
    basis = await queueStorageWrite(() =>
      replica.synchronization !== active
        ? Promise.resolve(undefined)
        : beginRepositoryHistorySynchronization(
            reader.connection.environmentId,
            reader.connection.logicalRepositoryId,
          ),
    );
  } catch (error) {
    if (!settleSynchronization(replica, active, false)) return;
    throw error;
  }
  if (
    reader.closed ||
    activeSynchronization(replica, reader, requestId) !== active
  )
    return;
  post(reader, {
    _tag: "SynchronizeHistory",
    ...(basis === undefined ? {} : { basis }),
    requestId,
  });
}

export function cancelSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  const active = replica.synchronization;
  if (active.status !== "syncing" || active.owner !== reader) return;
  post(reader, {
    _tag: "CancelHistorySynchronization",
    requestId: active.requestId,
  });
  settleSynchronization(replica, active, false);
}

export async function completeSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: Extract<
    RepositoryHistoryWorkerRequest,
    { _tag: "HistorySynchronizationCompleted" }
  >,
) {
  const active = activeSynchronization(replica, reader, message.requestId);
  if (active === undefined) return;
  try {
    const completion = await queueStorageWrite(() =>
      replica.synchronization !== active
        ? Promise.resolve(undefined)
        : completeStoredRepositoryHistory(
            reader.connection.environmentId,
            reader.connection.logicalRepositoryId,
            message.commitCount,
          ),
    );
    if (completion === undefined || replica.synchronization !== active) return;
    const snapshot = completion.snapshot;
    if (
      active.storingCommits ||
      (snapshot !== undefined &&
        (JSON.stringify(snapshot.refTargets) !==
          JSON.stringify(replica.refTargets) ||
          JSON.stringify(snapshot.shallowOids ?? []) !==
            JSON.stringify(replica.shallowOids)))
    )
      invalidateStoredHistory(replica);
    replica.synchronizedCommitCount = completion.commitCount;
    if (completion.snapshot !== undefined) {
      replica.shallowOids = completion.snapshot.shallowOids ?? [];
      replica.refTargets = completion.snapshot.refTargets;
    }
  } catch (error) {
    if (!settleSynchronization(replica, active, false)) return;
    throw error;
  }
  settleSynchronization(replica, active, true, "complete");
  void prepareRepositoryHistoryOrder(
    reader.connection.environmentId,
    reader.connection.logicalRepositoryId,
    replica.orderCache,
  ).catch(() => undefined);
  delete replica.failure;
  replica.revision += 1;
  publishSnapshot(replica);
  if (replica.needsReconciliation) await startSynchronization(reader, replica);
}

export async function failSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: Extract<
    RepositoryHistoryWorkerRequest,
    { _tag: "HistorySynchronizationFailed" }
  >,
) {
  const active = activeSynchronization(replica, reader, message.requestId);
  if (active === undefined) return;
  settleSynchronization(replica, active, message.failure._tag === "Offline");
  if (
    message.failure._tag === "Rejected" &&
    message.failure.detail._tag === "SnapshotInvalidated"
  ) {
    await queueStorageWrite(() =>
      restartRepositoryHistorySynchronization(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
      ),
    );
    invalidateStoredHistory(replica);
    await startSynchronization(reader, replica);
    return;
  }
  replica.failure = message.failure;
  replica.revision += 1;
  publishSnapshot(replica);
}
