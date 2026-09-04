import {
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  type RepositoryCommit,
} from "@rebase/contracts";
import type { HistoryOrderCache } from "#web/features/repository-history/history-order.contract";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/repository-history-epoch";
import {
  prepareRepositoryHistoryOrder,
  readRepositoryCommits,
  readRepositoryHistory,
} from "#web/features/repository-history/repository-history-query";
import {
  type RepositoryHistoryQuery,
  RepositoryHistoryStorageUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { watchRepositoryHistoryReaderLease } from "#web/features/repository-history/repository-history-reader-lease";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/repository-history-request-id";
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

const repositories = new Map<string, RepositoryReplica>();
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
    connectReader(message.data);
  };
  sharedPort.start();
};

function connectReader(connection: ConnectRepositoryHistoryReader) {
  const key = `${connection.environmentId}\0${connection.logicalRepositoryId}`;
  const replica =
    repositories.get(key) ??
    createReplica(connection.environmentId, connection.logicalRepositoryId);
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
          replica.reconciling = false;
          delete replica.synchronizationOwner;
          delete replica.synchronizationRequestId;
          replica.failure = failure;
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
}

async function handleReaderMessage(
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) {
  if (reader.closed) {
    return;
  }
  await replica.initialization;
  if (reader.closed) {
    return;
  }
  switch (message._tag) {
    case "ReadHistory": {
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
      const cached = await readRepositoryHistory(
        reader.connection.environmentId,
        reader.connection.logicalRepositoryId,
        message.query,
        globalThis.indexedDB,
        replica.orderCache,
      );
      if (!reader.epoch.isCurrent(message.requestId)) {
        reader.queries.delete(message.requestId);
        return;
      }
      if (cached !== undefined) {
        reader.epoch.finish(message.requestId);
        reader.queries.delete(message.requestId);
        for (const commit of cached) {
          replica.commits.set(commit.oid, commit);
        }
        replica.visibleOids = cached.map((commit) => commit.oid);
        delete replica.failure;
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
      if ((message.query.offset ?? 0) > 0) {
        reader.epoch.finish(message.requestId);
        reader.queries.delete(message.requestId);
        post(reader, {
          _tag: "RequestFailed",
          failure: { _tag: "Unavailable" },
          requestId: message.requestId,
        });
        return;
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
        const completion = await completeStoredRepositoryHistory(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
          message.commitCount,
        );
        delete replica.orderCache.index;
        replica.orderCache.revision += 1;
        if (completion.snapshot !== undefined) {
          replica.refTargets = completion.snapshot.refTargets;
        }
      } catch (error) {
        replica.synchronization = replica.reconciling ? "stale" : "idle";
        replica.reconciling = false;
        delete replica.synchronizationOwner;
        delete replica.synchronizationRequestId;
        throw error;
      }
      replica.synchronization = "complete";
      replica.reconciling = false;
      replica.synchronizedCommitCount = message.commitCount;
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
      return;
    case "HistorySynchronizationFailed":
      if (
        replica.synchronizationOwner !== reader ||
        replica.synchronizationRequestId !== message.requestId
      ) {
        return;
      }
      replica.synchronization = replica.reconciling ? "stale" : "idle";
      replica.reconciling = false;
      delete replica.synchronizationOwner;
      delete replica.synchronizationRequestId;
      if (
        message.failure._tag === "Rejected" &&
        message.failure.detail._tag === "SnapshotInvalidated"
      ) {
        await restartRepositoryHistorySynchronization(
          reader.connection.environmentId,
          reader.connection.logicalRepositoryId,
        );
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
  reader.stopWatchingLease();
  const activeRequestId = reader.epoch.cancel();
  if (activeRequestId !== undefined) {
    post(reader, {
      _tag: "CancelHistoryLoad",
      requestId: activeRequestId,
    });
  }
  replica.readers.delete(reader);
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
    await storeRepositoryHistoryPage(
      reader.connection.environmentId,
      reader.connection.logicalRepositoryId,
      page,
      query,
    );
    if (!reader.epoch.finish(requestId)) {
      return;
    }
    reader.queries.delete(requestId);
    const stored = await readRepositoryCommits(
      reader.connection.environmentId,
      reader.connection.logicalRepositoryId,
      page.commits.map((commit) => commit.oid),
    );
    for (const commit of stored) {
      replica.commits.set(commit.oid, commit);
    }
    if (replica.refTargets.length === 0) {
      replica.refTargets = page.refTargets;
    }
    replica.visibleOids = stored.map((commit) => commit.oid);
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
  const synchronizedCommitCount = await storeRepositoryHistoryBatch(
    reader.connection.environmentId,
    reader.connection.logicalRepositoryId,
    batch,
  );
  if (
    replica.synchronizationOwner !== reader ||
    replica.synchronizationRequestId !== requestId
  ) {
    return;
  }
  replica.synchronizedCommitCount = synchronizedCommitCount;
  replica.revision += 1;
  publishSnapshot(replica);
  post(reader, { _tag: "HistoryBatchCommitted", batchId });
}

async function startSynchronization(
  reader: ConnectedReader,
  replica: RepositoryReplica,
) {
  if (reader.closed || replica.synchronization === "syncing") {
    return;
  }
  replica.reconciled = true;
  const requestId = createRepositoryHistoryRequestId();
  replica.reconciling =
    replica.synchronization === "complete" ||
    replica.synchronization === "stale";
  replica.synchronization = "syncing";
  replica.synchronizationOwner = reader;
  replica.synchronizationRequestId = requestId;
  replica.synchronizedCommitCount = 0;
  replica.revision += 1;
  publishSnapshot(replica);
  let basis: Awaited<ReturnType<typeof beginRepositoryHistorySynchronization>>;
  try {
    basis = await beginRepositoryHistorySynchronization(
      reader.connection.environmentId,
      reader.connection.logicalRepositoryId,
    );
  } catch (error) {
    if (
      replica.synchronizationOwner === reader &&
      replica.synchronizationRequestId === requestId
    ) {
      replica.synchronization = replica.reconciling ? "stale" : "idle";
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
    ...(replica.failure === undefined ? {} : { failure: replica.failure }),
    revision: replica.revision,
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
    commits: new Map(),
    initialization: Promise.resolve(),
    readers: new Set(),
    refTargets: [],
    reconciling: false,
    revision: 0,
    status: "empty",
    synchronization: "idle",
    synchronizedCommitCount: 0,
    visibleOids: [],
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

function workerFailure(error: unknown): RepositoryHistoryWorkerFailure {
  return error instanceof RepositoryHistoryStorageUnavailable
    ? { _tag: "StorageUnavailable" }
    : { _tag: "Unavailable" };
}

interface ConnectedReader {
  stopWatchingLease: () => void;
  closed: boolean;
  readonly connection: ConnectRepositoryHistoryReader;
  readonly epoch: RepositoryHistoryEpoch;
  readonly queries: Map<string, RepositoryHistoryQuery>;
}

interface RepositoryReplica {
  reconciled: boolean;
  readonly orderCache: HistoryOrderCache;
  readonly commits: Map<string, RepositoryCommit>;
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
  visibleOids: readonly string[];
}
