import {
  clearHistoryCache,
  describeHistoryCaches,
} from "#web/features/repository-history/cache/repository-history-storage";
import { queueHistoryStorageWrite as queueStorageWrite } from "#web/features/repository-history/cache/repository-history-storage-maintenance";
import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryStorageDiagnostics,
} from "#web/features/repository-history/repository-history-storage.contract";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/transport/repository-history-request-id";
import { readHistory } from "#web/features/repository-history/worker/history-pages";
import type {
  ConnectedReader,
  RepositoryReplica,
} from "#web/features/repository-history/worker/history-worker.contract";
import { cancelReaderSearch } from "#web/features/repository-history/worker/reader-search";
import {
  invalidateStoredHistory,
  post,
  publishSnapshot,
  workerFailure,
} from "#web/features/repository-history/worker/replica-state";
import { repositories } from "#web/features/repository-history/worker/repository-replicas";
import { cancelSynchronization } from "#web/features/repository-history/worker/synchronization";
import { readHistoryCacheRecords } from "#web/persistence/repository-history/repository-history-cache-records";

export function scheduleCacheManagement(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  action: RepositoryHistoryCacheAction,
) {
  const operation = cacheManagement.then(() =>
    runCacheManagement(reader, replica, action),
  );
  cacheManagement = operation.catch(() => undefined);
  return operation;
}

async function runCacheManagement(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  action: RepositoryHistoryCacheAction,
) {
  if (action !== "clear-all") return manageCache(reader, replica, action);
  const completion = Promise.withResolvers<boolean>();
  clearingAllCaches = completion.promise;
  try {
    await manageCache(reader, replica, action);
    completion.resolve(true);
  } catch (error) {
    completion.resolve(false);
    throw error;
  } finally {
    clearingAllCaches = undefined;
  }
}

async function manageCache(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  action: RepositoryHistoryCacheAction,
) {
  const targets =
    action === "clear-all" ? [...repositories.values()] : [replica];
  await Promise.all(targets.map((target) => target.initialization));
  const priorPauses = new Map(
    targets.map((target) => [target, target.cachePaused ?? false]),
  );
  for (const target of targets) {
    target.cachePaused = true;
    if (target.synchronization.status === "syncing")
      cancelSynchronization(target.synchronization.owner, target);
    for (const connected of target.readers) {
      cancelReaderSearch(connected);
      const requestId = connected.epoch.cancel();
      connected.queries.clear();
      if (requestId !== undefined) {
        post(connected, { _tag: "CancelHistoryLoad", requestId });
        post(connected, {
          _tag: "RequestFailed",
          requestId,
          failure: { _tag: "Unavailable" },
        });
      }
    }
  }
  try {
    await queueStorageWrite(async () => {
      const caches =
        action === "clear-all"
          ? await readHistoryCacheRecords()
          : [
              {
                environmentId: reader.connection.environmentId,
                repositoryId: reader.connection.logicalRepositoryId,
              },
            ];
      for (const cache of caches)
        await clearHistoryCache(
          cache.environmentId,
          cache.repositoryId,
          action === "remove",
        );
    });
  } catch (error) {
    for (const target of targets) {
      target.cachePaused = priorPauses.get(target) ?? false;
      target.reconciled = false;
      invalidateStoredHistory(target, true);
      target.failure = workerFailure(error);
      target.status = "error";
      target.revision += 1;
      publishSnapshot(target);
    }
    throw error;
  }
  for (const target of targets) {
    invalidateStoredHistory(target, true);
    target.cachePaused = action !== "rebuild";
    target.reconciled = false;
    target.refTargets = [];
    target.status = "empty";
    target.synchronization = { status: "idle" };
    target.synchronizedCommitCount = 0;
    target.storageExhausted = false;
    delete target.failure;
    target.revision += 1;
    publishSnapshot(target);
  }
  if (action === "rebuild" && !reader.closed) {
    const query = reader.lastQuery;
    if (query !== undefined) {
      await readHistory(reader, replica, {
        _tag: "ReadHistory",
        query,
        requestId: createRepositoryHistoryRequestId(),
      });
    }
  }
}

let cacheManagement: Promise<void> = Promise.resolve();
export let clearingAllCaches: Promise<boolean> | undefined;

export async function readCacheDiagnostics(): Promise<RepositoryHistoryStorageDiagnostics> {
  const [caches, estimate, persistent] = await Promise.all([
    describeHistoryCaches((key) => repositories.has(key)),
    navigator.storage?.estimate().catch((): StorageEstimate => ({})),
    navigator.storage?.persisted().catch(() => false),
  ]);
  return {
    caches,
    persistent: persistent ?? false,
    ...(estimate?.usage === undefined ? {} : { usageBytes: estimate.usage }),
    ...(estimate?.quota === undefined ? {} : { quotaBytes: estimate.quota }),
  };
}
