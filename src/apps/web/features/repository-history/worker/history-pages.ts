import { decodeRepositoryHistoryPage } from "@rebase/contracts";
import { readCurrentRepositoryHistory } from "#web/features/repository-history/read-current-repository-history";
import { readRepositoryCommits } from "#web/features/repository-history/repository-history-query";
import { isHistoryStorageQuotaError } from "#web/features/repository-history/repository-history-storage-policy";
import { storeRepositoryHistoryPage } from "#web/features/repository-history/repository-history-store";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/repository-history-worker.contract";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import {
  invalidateStoredHistory,
  post,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";
import { writeStoredHistory } from "#web/features/repository-history/worker/repository-replicas";
import { startSynchronization } from "#web/features/repository-history/worker/synchronization";

export async function acceptHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  bytes: Uint8Array,
) {
  try {
    const page = decodeRepositoryHistoryPage(bytes);
    if (page.repositoryId !== reader.connection.repositoryId) {
      throw new Error("History page identity does not match the reader");
    }
    const query = reader.queries.get(requestId);
    if (query === undefined) {
      throw new Error("History page has no matching query");
    }
    await writeStoredHistory(() =>
      !reader.epoch.isCurrent(requestId)
        ? Promise.resolve()
        : storeRepositoryHistoryPage(
            reader.connection.environmentId,
            reader.connection.logicalRepositoryId,
            page,
            query,
          ),
    );
    if (!reader.epoch.finish(requestId)) {
      return;
    }
    invalidateStoredHistory(replica);
    reader.queries.delete(requestId);
    const stored = await readRepositoryCommits(
      reader.connection.environmentId,
      reader.connection.logicalRepositoryId,
      page.commits.map((commit) => commit.oid),
    );
    if (replica.refTargets.length === 0) {
      replica.refTargets = page.refTargets;
    }
    delete replica.failure;
    replica.status = stored.length === 0 ? "empty" : "ready";
    replica.revision += 1;
    publishSnapshot(replica);
    post(reader, {
      _tag: "HistoryResult",
      commits: stored,
      requestId,
    });
    if (replica.synchronization.status !== "syncing") {
      try {
        await startSynchronization(reader, replica);
      } catch (error) {
        replica.failure = workerFailure(error);
        replica.revision += 1;
        publishSnapshot(replica);
      }
    }
  } catch (error) {
    if (!reader.epoch.finish(requestId)) {
      return;
    }
    reader.queries.delete(requestId);
    const failure = workerFailure(error);
    replica.storageExhausted = isHistoryStorageQuotaError(error);
    replica.failure = failure;
    replica.status = "error";
    replica.revision += 1;
    publishSnapshot(replica);
    post(reader, { _tag: "RequestFailed", failure, requestId });
  }
}

export async function readHistory(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: Extract<RepositoryHistoryWorkerRequest, { _tag: "ReadHistory" }>,
) {
  reader.lastQuery = message.query;
  if (replica.cachePaused) {
    post(reader, {
      _tag: "HistoryResult",
      commits: [],
      requestId: message.requestId,
    });
    return;
  }
  const supersededRequestId = reader.epoch.begin(message.requestId);
  if (supersededRequestId !== undefined) {
    reader.queries.delete(supersededRequestId);
    post(reader, {
      _tag: "CancelHistoryLoad",
      requestId: supersededRequestId,
    });
    post(reader, {
      _tag: "RequestFailed",
      failure: { _tag: "Unavailable" },
      requestId: supersededRequestId,
    });
  }
  reader.queries.set(message.requestId, message.query);
  const cached = await readCurrentRepositoryHistory(
    reader.connection.environmentId,
    reader.connection.logicalRepositoryId,
    message.query,
    replica.orderCache,
    () => reader.epoch.isCurrent(message.requestId),
  );
  if (!reader.epoch.isCurrent(message.requestId)) {
    reader.queries.delete(message.requestId);
    return;
  }
  if (cached !== undefined) {
    reader.epoch.finish(message.requestId);
    reader.queries.delete(message.requestId);
    if (!replica.storageExhausted) delete replica.failure;
    replica.status = cached.length === 0 ? "empty" : "ready";
    replica.revision += 1;
    publishSnapshot(replica);
    post(reader, {
      _tag: "HistoryResult",
      commits: cached,
      requestId: message.requestId,
    });
    if (!replica.reconciled && replica.synchronization.status !== "syncing") {
      void startSynchronization(reader, replica).catch((error) => {
        replica.failure = workerFailure(error);
        replica.revision += 1;
        publishSnapshot(replica);
      });
    }
    return;
  }
  if (replica.synchronization.status === "complete") {
    replica.synchronization = { status: "stale" };
  }
  replica.status = "loading";
  publishSnapshot(replica);
  post(reader, {
    _tag: "LoadHistory",
    query: message.query,
    requestId: message.requestId,
  });
  return;
}
