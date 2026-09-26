import {
  decodeRepositoryHistoryPage,
  type RepositoryHistoryPage,
} from "@rebase/contracts";
import { isHistoryStorageQuotaError } from "#web/features/repository-history/cache/repository-history-storage-policy";
import { readCurrentRepositoryHistory } from "#web/features/repository-history/query/read-current-repository-history";
import { storeRepositoryHistoryPage } from "#web/features/repository-history/replica/repository-history-store";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker-state";
import {
  invalidateStoredHistory,
  post,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";
import type { RepositoryHistoryWorkerRequest } from "#web/features/repository-history/worker/repository-history-worker.contract";
import { writeStoredHistory } from "#web/features/repository-history/worker/repository-replicas";
import { startSynchronization } from "#web/features/repository-history/worker/synchronization";

export async function acceptHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  bytes: Uint8Array,
) {
  let received: { page: RepositoryHistoryPage; query: RepositoryHistoryQuery };
  try {
    received = decodeReceivedPage(reader, requestId, bytes);
  } catch (error) {
    failHistoryPage(reader, replica, requestId, error);
    return;
  }
  if (!reader.epoch.finish(requestId)) {
    return;
  }
  reader.queries.delete(requestId);
  showHistoryPage(reader, replica, requestId, received.page);
  if (await cacheHistoryPage(reader, replica, received.page, received.query)) {
    await synchronizeAfterPage(reader, replica);
  }
}

function decodeReceivedPage(
  reader: ConnectedReader,
  requestId: string,
  bytes: Uint8Array,
) {
  const page = decodeRepositoryHistoryPage(bytes);
  if (page.repositoryId !== reader.connection.repositoryId) {
    throw new Error("History page identity does not match the reader");
  }
  const query = reader.queries.get(requestId);
  if (query === undefined) {
    throw new Error("History page has no matching query");
  }
  return { page, query };
}

function showHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  page: RepositoryHistoryPage,
) {
  if (replica.refTargets.length === 0) {
    replica.refTargets = page.refTargets;
  }
  delete replica.failure;
  replica.status = page.commits.length === 0 ? "empty" : "ready";
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, {
    _tag: "HistoryResult",
    commits: page.commits,
    requestId,
  });
}

async function cacheHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
) {
  try {
    await writeStoredHistory(() =>
      storeRepositoryHistoryPage(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        page,
        query,
      ),
    );
    invalidateStoredHistory(replica);
    return true;
  } catch (error) {
    replica.storageExhausted = isHistoryStorageQuotaError(error);
    replica.failure = workerFailure(error);
    replica.revision += 1;
    publishSnapshot(replica);
    return false;
  }
}

async function synchronizeAfterPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (replica.synchronization.status === "syncing") return;
  try {
    await startSynchronization(reader, replica);
  } catch (error) {
    replica.failure = workerFailure(error);
    replica.revision += 1;
    publishSnapshot(replica);
  }
}

function failHistoryPage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  error: unknown,
) {
  if (!reader.epoch.finish(requestId)) {
    return;
  }
  reader.queries.delete(requestId);
  const failure = workerFailure(error);
  replica.failure = failure;
  replica.status = "error";
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "RequestFailed", failure, requestId });
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
