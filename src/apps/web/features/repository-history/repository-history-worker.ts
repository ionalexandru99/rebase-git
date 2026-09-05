import {
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type RepositoryFreshness,
} from "@rebase/contracts";
import type { HistoryOrderCache } from "#web/features/repository-history/history-order.contract";
import { readCurrentRepositoryHistory } from "#web/features/repository-history/read-current-repository-history";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/repository-history-epoch";
import {
  locateRepositoryHistoryCommit,
  locateRepositoryHistoryCommits,
  prepareRepositoryHistoryOrder,
  readRepositoryCommits,
} from "#web/features/repository-history/repository-history-query";
import {
  type RepositoryHistoryQuery,
  RepositoryHistoryStorageUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { watchRepositoryHistoryReaderLease } from "#web/features/repository-history/repository-history-reader-lease";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/repository-history-request-id";
import {
  clearHistoryCache,
  describeHistoryCaches,
  markHistoryCacheOpened,
  readHistoryCacheRecords,
} from "#web/features/repository-history/repository-history-storage";
import type { RepositoryHistoryCacheAction } from "#web/features/repository-history/repository-history-storage.contract";
import {
  queueHistoryStorageWrite as queueStorageWrite,
  writeHistoryUnderPressure,
} from "#web/features/repository-history/repository-history-storage-maintenance";
import { isHistoryStorageQuotaError } from "#web/features/repository-history/repository-history-storage-policy";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  readStoredRepositoryHistoryState,
  restartRepositoryHistorySynchronization,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerFailure,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/repository-history-worker.contract";
import { searchStoredRepositoryHistory } from "#web/features/repository-history/search/repository-history-search";

const repositories = new Map<string, RepositoryReplica>();
let cacheManagement: Promise<void> = Promise.resolve();
let clearingAllCaches: Promise<boolean> | undefined;
const worker = self as unknown as {
  onconnect: ((event: MessageEvent) => void) | null;
};

worker.onconnect = (event) => {
  const sharedPort = event.ports[0];
  if (sharedPort === undefined) {
    return;
  }
  sharedPort.onmessage = (
    message: MessageEvent<ConnectRepositoryHistoryReader>,
  ) => {
    if (message.data._tag !== "ConnectRepositoryHistoryReader") {
      return;
    }
    if (clearingAllCaches === undefined) connectReader(message.data);
    else
      void clearingAllCaches.then((cleared) =>
        connectReader(message.data, cleared),
      );
  };
  sharedPort.start();
};

function connectReader(
  connection: ConnectRepositoryHistoryReader,
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
    void handleReaderMessage(reader, replica, event.data).catch((error) => {
      if (event.data._tag === "HistoryBatchReceived") {
        const failure = workerFailure(error);
        if (
          replica.synchronizationOwner === reader &&
          replica.synchronizationRequestId === event.data.requestId
        ) {
          replica.synchronization = replica.reconciling ? "stale" : "idle";
          replica.reconciled = false;
          replica.storingCommits = false;
          replica.reconciling = false;
          delete replica.synchronizationOwner;
          delete replica.synchronizationRequestId;
          replica.failure = failure;
          replica.storageExhausted = isHistoryStorageQuotaError(error);
          replica.revision += 1;
          publishSnapshot(replica);
        }
        post(reader, {
          _tag: "HistoryBatchFailed",
          batchId: event.data.batchId,
          failure,
        });
        return;
      }
      if (!("requestId" in event.data)) {
        return;
      }
      const failure = workerFailure(error);
      replica.failure = failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(replica);
      post(reader, {
        _tag: "RequestFailed",
        failure,
        requestId: event.data.requestId,
      });
    });
  };
  connection.port.start();
  postSnapshot(reader, replica);
  assignFreshnessOwner(replica);
}

function rejectOversizedNavigation(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerRequest,
): boolean {
  const oversized =
    (message._tag === "GetAncestryRoute" && message.roots.length > 256) ||
    (message._tag === "LocateHistoryCommits" && message.oids.length > 1_000);
  if (!oversized) return false;
  post(reader, {
    _tag: "RequestFailed",
    requestId: message.requestId,
    failure: { _tag: "Unavailable" },
  });
  return true;
}

async function handleReaderMessage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) {
  if (reader.closed) {
    return;
  }
  if (rejectOversizedNavigation(reader, message)) return;
  await replica.initialization;
  if (reader.closed) {
    return;
  }
  switch (message._tag) {
    case "LocateHistoryCommits": {
      const positions = await locateRepositoryHistoryCommits(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        message.oids,
        replica.orderCache,
      );
      post(reader, {
        _tag: "HistoryPositionsResult",
        positions,
        requestId: message.requestId,
      });
      return;
    }
    case "SearchHistory":
      await searchHistory(reader, message);
      return;
    case "CancelHistorySearch":
      if (reader.search?.requestId === message.requestId)
        reader.search.controller.abort();
      return;
    case "GetCacheDiagnostics": {
      const [caches, estimate, persistent] = await Promise.all([
        describeHistoryCaches((key) => repositories.has(key)),
        navigator.storage?.estimate().catch((): StorageEstimate => ({})),
        navigator.storage?.persisted().catch(() => false),
      ]);
      post(reader, {
        _tag: "CacheDiagnosticsResult",
        diagnostics: {
          caches,
          persistent: persistent ?? false,
          ...(estimate?.usage === undefined
            ? {}
            : { usageBytes: estimate.usage }),
          ...(estimate?.quota === undefined
            ? {}
            : { quotaBytes: estimate.quota }),
        },
        requestId: message.requestId,
      });
      return;
    }
    case "GetAncestryRoute": {
      const revision = replica.orderCache.revision;
      const state = await readStoredRepositoryHistoryState(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
      );
      if (
        state?.completion !== undefined &&
        replica.orderCache.index === undefined
      )
        await prepareRepositoryHistoryOrder(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
          replica.orderCache,
        );
      post(reader, {
        _tag: "AncestryRouteResult",
        route:
          state?.completion !== undefined &&
          replica.orderCache.revision === revision
            ? replica.orderCache.index?.ancestryRoute(
                message.roots,
                message.oid,
              )
            : undefined,
        requestId: message.requestId,
      });
      return;
    }
    case "LocateHistoryCommit": {
      const position = await locateRepositoryHistoryCommit(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        message.oid,
        replica.orderCache,
      );
      post(reader, {
        _tag: "HistoryPositionResult",
        position,
        requestId: message.requestId,
      });
      return;
    }
    case "FetchHistory":
    case "ConfigureFetch": {
      const owner = replica.freshnessOwner;
      if (
        owner === undefined ||
        owner.closed ||
        replica.freshness === undefined
      ) {
        post(reader, {
          _tag: "RequestFailed",
          requestId: message.requestId,
          failure: { _tag: "Unavailable" },
        });
        return;
      }
      replica.freshnessCommands.set(message.requestId, reader);
      post(
        owner,
        message._tag === "FetchHistory"
          ? { _tag: "RunFetchHistory", requestId: message.requestId }
          : {
              _tag: "RunConfigureFetch",
              requestId: message.requestId,
              setting: message.setting,
            },
      );
      return;
    }
    case "FreshnessChanged":
      if (replica.freshnessOwner === reader)
        await acceptFreshness(reader, replica, message.freshness);
      return;
    case "FreshnessFailed":
      if (replica.freshnessOwner === reader) {
        replica.freshnessFailure = message.failure;
        replica.revision += 1;
        publishSnapshot(replica);
      }
      return;
    case "FreshnessCommandCompleted":
    case "FreshnessCommandFailed": {
      if (replica.freshnessOwner !== reader) return;
      const requester = replica.freshnessCommands.get(message.requestId);
      replica.freshnessCommands.delete(message.requestId);
      if (message._tag === "FreshnessCommandCompleted") {
        await acceptFreshness(reader, replica, message.freshness);
        if (requester !== undefined)
          post(requester, {
            _tag: "FreshnessResult",
            requestId: message.requestId,
            freshness: message.freshness,
          });
      } else if (requester !== undefined) {
        post(requester, {
          _tag: "RequestFailed",
          requestId: message.requestId,
          failure: message.failure,
        });
      }
      return;
    }
    case "ManageCache":
      await scheduleCacheManagement(reader, replica, message.action);
      post(reader, { _tag: "CacheManaged", requestId: message.requestId });
      if (message.action === "remove") {
        for (const connected of [...replica.readers]) {
          post(connected, { _tag: "CacheRemoved" });
          await handleReaderMessage(connected, replica, {
            _tag: "CloseReader",
          });
        }
      }
      return;
    case "ReadHistory": {
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
        if (!replica.reconciled && replica.synchronization !== "syncing") {
          void startSynchronization(reader, replica).catch((error) => {
            replica.failure = workerFailure(error);
            replica.revision += 1;
            publishSnapshot(replica);
          });
        }
        return;
      }
      if (replica.synchronization === "complete") {
        replica.synchronization = "stale";
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
    case "HistoryPageReceived":
      if (!reader.epoch.isCurrent(message.requestId)) {
        return;
      }
      await acceptHistoryPage(
        reader,
        replica,
        message.requestId,
        message.bytes,
      );
      return;
    case "HistoryPageFailed":
      if (!reader.epoch.finish(message.requestId)) {
        return;
      }
      reader.queries.delete(message.requestId);
      replica.failure = message.failure;
      replica.status = "error";
      replica.revision += 1;
      publishSnapshot(replica);
      post(reader, {
        _tag: "RequestFailed",
        failure: message.failure,
        requestId: message.requestId,
      });
      return;
    case "HistoryBatchReceived":
      await acceptHistoryBatch(
        reader,
        replica,
        message.requestId,
        message.batchId,
        message.bytes,
      );
      return;
    case "HistorySynchronizationCompleted":
      if (
        replica.synchronizationOwner !== reader ||
        replica.synchronizationRequestId !== message.requestId
      ) {
        return;
      }
      try {
        const completion = await queueStorageWrite(() =>
          replica.synchronizationOwner !== reader ||
          replica.synchronizationRequestId !== message.requestId
            ? Promise.resolve(undefined)
            : completeStoredRepositoryHistory(
                reader.connection.environmentId,
                reader.connection.logicalRepositoryId,
                message.commitCount,
              ),
        );
        if (
          completion === undefined ||
          replica.synchronizationRequestId !== message.requestId
        )
          return;
        invalidateStoredHistory(replica);
        replica.synchronizedCommitCount = completion.commitCount;
        if (completion.snapshot !== undefined) {
          replica.shallowOids = completion.snapshot.shallowOids ?? [];
          replica.refTargets = completion.snapshot.refTargets;
        }
      } catch (error) {
        replica.synchronization = replica.reconciling ? "stale" : "idle";
        replica.reconciled = false;
        replica.storingCommits = false;
        replica.reconciling = false;
        delete replica.synchronizationOwner;
        delete replica.synchronizationRequestId;
        throw error;
      }
      replica.synchronization = "complete";
      replica.storingCommits = false;
      replica.reconciling = false;
      void prepareRepositoryHistoryOrder(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        replica.orderCache,
      ).catch(() => undefined);
      delete replica.failure;
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
      replica.revision += 1;
      publishSnapshot(replica);
      if (replica.needsReconciliation)
        await startSynchronization(reader, replica);
      return;
    case "HistorySynchronizationFailed":
      if (
        replica.synchronizationOwner !== reader ||
        replica.synchronizationRequestId !== message.requestId
      ) {
        return;
      }
      replica.synchronization = replica.reconciling ? "stale" : "idle";
      replica.reconciled = message.failure._tag === "Offline";
      replica.storingCommits = false;
      replica.reconciling = false;
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
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
      return;
    case "GetCommitSummaries": {
      const commits = await readRepositoryCommits(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.oids,
      );
      post(reader, {
        _tag: "CommitSummariesResult",
        commits,
        requestId: message.requestId,
      });
      return;
    }
    case "GetRefTargets":
      post(reader, {
        _tag: "RefTargetsResult",
        refs: replica.refTargets,
        requestId: message.requestId,
      });
      return;
    case "ReconcileHistory":
      replica.needsReconciliation = true;
      if (replica.synchronization !== "syncing") {
        await startSynchronization(reader, replica);
      }
      return;
    case "CloseReader":
      closeReader(reader, replica);
      return;
  }
}

function closeReader(reader: ConnectedReader, replica: RepositoryReplica) {
  if (reader.closed) return;
  reader.search?.controller.abort();
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
  const ownedSynchronization = replica.synchronizationOwner === reader;
  if (ownedSynchronization) {
    cancelSynchronization(reader, replica);
  }
  reader.closed = true;
  if (replica.readers.size === 0) {
    replica.orderCache.revision += 1;
    delete replica.orderCache.index;
    replica.orderCache.queries.clear();
    repositories.delete(
      `${reader.connection.environmentId}\0${reader.connection.logicalRepositoryId}`,
    );
  } else if (ownedSynchronization && replica.synchronization !== "complete") {
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
}

async function acceptHistoryPage(
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
    if (replica.synchronization !== "syncing") {
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

async function acceptHistoryBatch(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  requestId: string,
  batchId: string,
  bytes: Uint8Array,
) {
  if (
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  const batch = decodeRepositoryHistoryBatch(bytes);
  if (batch.repositoryId !== reader.connection.repositoryId) {
    throw new Error("History batch identity does not match the reader");
  }
  const synchronizedCommitCount = await writeStoredHistory(() =>
    replica.synchronizationRequestId !== requestId
      ? Promise.resolve(replica.synchronizedCommitCount)
      : storeRepositoryHistoryBatch(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
          batch,
        ),
  );
  if (
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  replica.synchronizedCommitCount = synchronizedCommitCount;
  if (batch.commits.length > 0) replica.storingCommits = true;
  invalidateStoredHistory(replica);
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "HistoryBatchCommitted", batchId });
}

async function startSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (
    reader.closed ||
    replica.cachePaused ||
    replica.storageExhausted ||
    replica.synchronization === "syncing"
  ) {
    return;
  }
  replica.reconciled = true;
  const requestId = createRepositoryHistoryRequestId();
  replica.needsReconciliation = false;
  replica.storingCommits = false;
  replica.reconciling =
    replica.synchronization === "complete" ||
    replica.synchronization === "stale";
  replica.synchronization = "syncing";
  replica.synchronizationOwner = reader;
  replica.synchronizationRequestId = requestId;
  replica.revision += 1;
  publishSnapshot(replica);
  let basis: Awaited<ReturnType<typeof beginRepositoryHistorySynchronization>>;
  try {
    basis = await queueStorageWrite(() =>
      replica.synchronizationRequestId !== requestId
        ? Promise.resolve(undefined)
        : beginRepositoryHistorySynchronization(
            reader.connection.environmentId,
            reader.connection.logicalRepositoryId,
          ),
    );
  } catch (error) {
    if (
      replica.synchronizationOwner === reader &&
      replica.synchronizationRequestId === requestId
    ) {
      replica.synchronization = replica.reconciling ? "stale" : "idle";
      replica.reconciled = false;
      replica.reconciling = false;
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
    }
    throw error;
  }
  if (
    reader.closed ||
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  post(reader, {
    _tag: "SynchronizeHistory",
    ...(basis === undefined ? {} : { basis }),
    requestId,
  });
}

function cancelSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  const requestId = replica.synchronizationRequestId;
  if (requestId !== undefined) {
    post(reader, { _tag: "CancelHistorySynchronization", requestId });
  }
  replica.synchronization = replica.reconciling ? "stale" : "idle";
  replica.storingCommits = false;
  delete replica.synchronizationOwner;
  delete replica.synchronizationRequestId;
}

function publishSnapshot(replica: RepositoryReplica) {
  for (const reader of replica.readers) {
    postSnapshot(reader, replica);
  }
}

function postSnapshot(reader: ConnectedReader, replica: RepositoryReplica) {
  post(reader, {
    _tag: "SnapshotChanged",
    shallowOids: replica.shallowOids,
    ...(replica.freshness === undefined
      ? {}
      : { freshness: replica.freshness }),
    ...(replica.freshnessFailure === undefined
      ? {}
      : { freshnessFailure: replica.freshnessFailure }),
    storingCommits: replica.storingCommits,
    cachePaused: replica.cachePaused ?? false,
    ...(replica.failure === undefined ? {} : { failure: replica.failure }),
    revision: replica.revision,
    historyRevision: replica.orderCache.revision,
    status: replica.status,
    synchronization: replica.synchronization,
    synchronizedCommitCount: replica.synchronizedCommitCount,
  });
}

function post(
  reader: ConnectedReader,
  message: RepositoryHistoryWorkerResponse,
) {
  if (!reader.closed) {
    reader.connection.port.postMessage(message);
  }
}

function createReplica(
  environmentId: string,
  repositoryId: string,
): RepositoryReplica {
  const replica: RepositoryReplica = {
    orderCache: { queries: new Map(), revision: 0 },
    reconciled: false,
    shallowOids: [],
    freshnessCommands: new Map(),
    needsReconciliation: false,
    storingCommits: false,
    initialization: Promise.resolve(),
    readers: new Set(),
    refTargets: [],
    reconciling: false,
    revision: 0,
    status: "empty",
    synchronization: "idle",
    synchronizedCommitCount: 0,
  };
  replica.initialization = restoreReplica(replica, environmentId, repositoryId);
  return replica;
}

async function restoreReplica(
  replica: RepositoryReplica,
  environmentId: string,
  repositoryId: string,
) {
  try {
    if (!(await markHistoryCacheOpened(environmentId, repositoryId))) {
      await clearHistoryCache(environmentId, repositoryId, false);
      invalidateStoredHistory(replica, true);
      replica.revision += 1;
      publishSnapshot(replica);
      return;
    }
    const state = await readStoredRepositoryHistoryState(
      environmentId,
      repositoryId,
    );
    if (state === undefined) {
      return;
    }
    replica.refTargets = state.refTargets;
    replica.synchronizedCommitCount = state.progress.committedCommitCount;
    if (state.completion !== undefined) {
      void prepareRepositoryHistoryOrder(
        environmentId,
        repositoryId,
        replica.orderCache,
      ).catch(() => undefined);
      replica.shallowOids = state.completion.snapshot?.shallowOids ?? [];
      replica.synchronization = "complete";
      replica.synchronizedCommitCount = state.completion.commitCount;
      replica.status = state.completion.commitCount === 0 ? "empty" : "ready";
    }
    replica.revision += 1;
    publishSnapshot(replica);
  } catch (error) {
    replica.failure = workerFailure(error);
    replica.status = "error";
    replica.revision += 1;
    publishSnapshot(replica);
  }
}

function assignFreshnessOwner(replica: RepositoryReplica) {
  if (replica.freshnessOwner !== undefined) return;
  const owner = [...replica.readers].find(
    (reader) => !reader.closed && reader.connection.supportsFreshness,
  );
  if (owner === undefined) return;
  replica.freshnessOwner = owner;
  post(owner, { _tag: "SubscribeFreshness" });
}

async function acceptFreshness(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  freshness: RepositoryFreshness,
) {
  const changed =
    replica.freshness !== undefined &&
    replica.freshness.revision !== freshness.revision;
  replica.freshness = freshness;
  delete replica.freshnessFailure;
  replica.revision += 1;
  publishSnapshot(replica);
  if (!changed) return;
  replica.needsReconciliation = true;
  if (
    replica.synchronization !== "syncing" &&
    (replica.status === "ready" ||
      replica.synchronization === "complete" ||
      replica.synchronization === "stale")
  )
    await startSynchronization(reader, replica).catch((error) => {
      replica.failure = workerFailure(error);
      replica.revision += 1;
      publishSnapshot(replica);
    });
}

function closeFreshness(reader: ConnectedReader, replica: RepositoryReplica) {
  for (const [requestId, requester] of replica.freshnessCommands) {
    if (requester === reader || replica.freshnessOwner === reader) {
      replica.freshnessCommands.delete(requestId);
      if (requester !== reader)
        post(requester, {
          _tag: "RequestFailed",
          requestId,
          failure: { _tag: "Unavailable" },
        });
    }
  }
  if (replica.freshnessOwner === reader) {
    post(reader, { _tag: "UnsubscribeFreshness" });
    delete replica.freshnessOwner;
    assignFreshnessOwner(replica);
  }
}

function workerFailure(error: unknown): RepositoryHistoryWorkerFailure {
  return error instanceof RepositoryHistoryStorageUnavailable
    ? { _tag: "StorageUnavailable" }
    : { _tag: "Unavailable" };
}

function writeStoredHistory<T>(write: () => Promise<T>) {
  return writeHistoryUnderPressure(write, (key) => repositories.has(key));
}

async function searchHistory(
  reader: ConnectedReader,
  message: Extract<RepositoryHistoryWorkerRequest, { _tag: "SearchHistory" }>,
) {
  reader.search?.controller.abort();
  const controller = new AbortController();
  reader.search = { requestId: message.requestId, controller };
  try {
    const result = await searchStoredRepositoryHistory(
      reader.connection.environmentId,
      reader.connection.logicalRepositoryId,
      message.query,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    post(reader, {
      _tag: "HistorySearchResult",
      result,
      requestId: message.requestId,
    });
  } catch (error) {
    if (controller.signal.aborted)
      post(reader, {
        _tag: "HistorySearchCanceled",
        requestId: message.requestId,
      });
    else
      post(reader, {
        _tag: "RequestFailed",
        failure: workerFailure(error),
        requestId: message.requestId,
      });
  } finally {
    if (reader.search?.requestId === message.requestId) delete reader.search;
  }
}

function scheduleCacheManagement(
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
    if (target.synchronizationOwner !== undefined)
      cancelSynchronization(target.synchronizationOwner, target);
    for (const connected of target.readers) {
      connected.search?.controller.abort();
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
    target.synchronization = "idle";
    target.synchronizedCommitCount = 0;
    target.storageExhausted = false;
    delete target.failure;
    target.revision += 1;
    publishSnapshot(target);
  }
  if (action === "rebuild") {
    const query = reader.lastQuery;
    if (query !== undefined) {
      await handleReaderMessage(reader, replica, {
        _tag: "ReadHistory",
        query,
        requestId: createRepositoryHistoryRequestId(),
      });
    }
  }
}

function invalidateStoredHistory(
  replica: RepositoryReplica,
  discardOrder = false,
) {
  replica.orderCache.revision += 1;
  delete replica.orderCache.index;
  if (discardOrder) replica.orderCache.queries.clear();
}

interface ConnectedReader {
  stopWatchingLease: () => void;
  search?: { readonly requestId: string; readonly controller: AbortController };
  closed: boolean;
  lastQuery?: RepositoryHistoryQuery;
  readonly connection: ConnectRepositoryHistoryReader;
  readonly epoch: RepositoryHistoryEpoch;
  readonly queries: Map<string, RepositoryHistoryQuery>;
}

interface RepositoryReplica {
  reconciled: boolean;
  readonly orderCache: HistoryOrderCache;
  shallowOids: readonly string[];
  freshness?: RepositoryFreshness;
  freshnessFailure?: RepositoryHistoryWorkerFailure;
  freshnessOwner?: ConnectedReader;
  readonly freshnessCommands: Map<string, ConnectedReader>;
  needsReconciliation: boolean;
  storingCommits: boolean;
  cachePaused?: boolean;
  storageExhausted?: boolean;
  failure?: RepositoryHistoryWorkerFailure;
  initialization: Promise<void>;
  revision: number;
  refTargets: Extract<
    RepositoryHistoryWorkerResponse,
    { _tag: "RefTargetsResult" }
  >["refs"];
  readonly readers: Set<ConnectedReader>;
  reconciling: boolean;
  status: "empty" | "error" | "loading" | "ready";
  synchronization: "complete" | "idle" | "stale" | "syncing";
  synchronizationOwner?: ConnectedReader;
  synchronizationRequestId?: string;
  synchronizedCommitCount: number;
}
