import type { RepositoryCommit } from "@rebase/contracts";
import type { HistoryAncestryRoute } from "#web/features/repository-history/history-order.contract";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryPosition,
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import {
  RepositoryHistoryOffline,
  RepositoryHistoryRejected,
  RepositoryHistoryStorageUnavailable,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { holdRepositoryHistoryReaderLease } from "#web/features/repository-history/repository-history-reader-lease";
import { maintainRepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader-lifecycle";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/repository-history-request-id";
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerFailure,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/repository-history-worker.contract";

let sharedWorker: SharedWorker | undefined;
let persistenceRequested = false;

interface BrowserRepositoryHistoryReaderOptions {
  readonly environmentId: string;
  readonly gateway: RepositoryHistoryGateway;
  readonly logicalRepositoryId?: string;
  readonly repositoryId: string;
  readonly worker?: SharedWorker;
}

export function createBrowserRepositoryHistoryReader(
  options: BrowserRepositoryHistoryReaderOptions,
): RepositoryHistoryReader {
  let cachePaused = false;
  const reader: RepositoryHistoryReader = maintainRepositoryHistoryReader(() =>
    connectBrowserRepositoryHistoryReader(
      options,
      () => reader.close(),
      (paused) => {
        cachePaused = paused;
      },
      cachePaused,
    ),
  );
  return reader;
}

function connectBrowserRepositoryHistoryReader(
  options: BrowserRepositoryHistoryReaderOptions,
  onRemoved: () => void,
  onCachePaused: (paused: boolean) => void,
  cachePaused: boolean,
): RepositoryHistoryReader {
  const worker = options.worker ?? acquireSharedWorker();
  requestPersistentStorage();
  const channel = new MessageChannel();
  const port = channel.port1;
  const listeners = new Set<() => void>();
  const pending = new Map<string, PendingRequest>();
  const loads = new Map<string, AbortController>();
  const synchronizations = new Map<string, AbortController>();
  const pendingBatches = new Map<string, PendingBatch>();
  let closed = false;
  let snapshot: RepositoryHistorySnapshot = {
    revision: 0,
    historyRevision: 0,
    status: "empty",
  };

  port.onmessage = (event: MessageEvent<RepositoryHistoryWorkerResponse>) => {
    const message = event.data;
    if (message._tag === "CacheRemoved") {
      onRemoved();
      return;
    }
    if (message._tag === "LoadHistory") {
      loadHistory(message.requestId, message.query);
      return;
    }
    if (message._tag === "CancelHistoryLoad") {
      loads.get(message.requestId)?.abort();
      loads.delete(message.requestId);
      return;
    }
    if (message._tag === "SynchronizeHistory") {
      synchronizeHistory(message.requestId, message.basis);
      return;
    }
    if (message._tag === "CancelHistorySynchronization") {
      synchronizations.get(message.requestId)?.abort();
      synchronizations.delete(message.requestId);
      rejectSynchronizationBatches(message.requestId);
      return;
    }
    if (message._tag === "HistoryBatchCommitted") {
      pendingBatches.get(message.batchId)?.resolve();
      pendingBatches.delete(message.batchId);
      return;
    }
    if (message._tag === "HistoryBatchFailed") {
      pendingBatches.get(message.batchId)?.reject(readerError(message.failure));
      pendingBatches.delete(message.batchId);
      return;
    }
    if (message._tag === "SnapshotChanged") {
      onCachePaused(message.cachePaused ?? false);
      snapshot = {
        ...(message.failure === undefined
          ? {}
          : { error: readerError(message.failure) }),
        revision: message.revision,
        historyRevision: message.historyRevision,
        status: message.status,
        synchronization: message.synchronization,
        synchronizedCommitCount: message.synchronizedCommitCount,
      };
      for (const listener of listeners) {
        listener();
      }
      return;
    }
    const request = pending.get(message.requestId);
    if (request === undefined) {
      return;
    }
    pending.delete(message.requestId);
    if (message._tag === "RequestFailed") {
      request.reject(readerError(message.failure));
      return;
    }
    if (message._tag === "RefTargetsResult") {
      request.resolve(message.refs);
      return;
    }
    if (message._tag === "AncestryRouteResult") {
      request.resolve(message.route);
      return;
    }
    if (message._tag === "HistoryPositionResult") {
      request.resolve(message.position);
      return;
    }
    if (message._tag === "HistoryPositionsResult") {
      request.resolve(message.positions);
      return;
    }
    if (message._tag === "CacheDiagnosticsResult") {
      request.resolve(message.diagnostics);
      return;
    }
    if (message._tag === "CacheManaged") {
      request.resolve(undefined);
      return;
    }
    request.resolve(message.commits);
  };
  port.start();
  const releaseLease = holdRepositoryHistoryReaderLease((lifetimeLock) => {
    const connection: ConnectRepositoryHistoryReader = {
      _tag: "ConnectRepositoryHistoryReader",
      environmentId: options.environmentId,
      logicalRepositoryId: options.logicalRepositoryId ?? options.repositoryId,
      cachePaused,
      ...(lifetimeLock === undefined ? {} : { lifetimeLock }),
      port: channel.port2,
      repositoryId: options.repositoryId,
    };
    worker.port.postMessage(connection, [channel.port2]);
    worker.port.start();
  });
  const unsubscribeAvailability = options.gateway.subscribeAvailability?.(
    () => {
      port.postMessage({
        _tag: "ReconcileHistory",
      } satisfies RepositoryHistoryWorkerRequest);
    },
  );

  function loadHistory(requestId: string, query: RepositoryHistoryQuery) {
    const controller = new AbortController();
    loads.set(requestId, controller);
    void options.gateway
      .read(
        {
          limit: query.limit,
          order: query.order,
          repositoryId: options.repositoryId,
          roots: query.roots,
        },
        controller.signal,
      )
      .then(
        (bytes) => {
          const message: RepositoryHistoryWorkerRequest = {
            _tag: "HistoryPageReceived",
            bytes,
            requestId,
          };
          port.postMessage(message, [bytes.buffer]);
        },
        (error: unknown) => {
          const message: RepositoryHistoryWorkerRequest = {
            _tag: "HistoryPageFailed",
            failure: workerFailure(error),
            requestId,
          };
          port.postMessage(message);
        },
      )
      .finally(() => loads.delete(requestId));
  }

  function synchronizeHistory(
    requestId: string,
    basis: Parameters<RepositoryHistoryGateway["synchronize"]>[0]["basis"],
  ) {
    const controller = new AbortController();
    synchronizations.set(requestId, controller);
    void options.gateway
      .synchronize(
        {
          ...(basis === undefined ? {} : { basis }),
          priority: "visible",
          repositoryId: options.repositoryId,
        },
        (bytes) => {
          const batchId = createRepositoryHistoryRequestId();
          return new Promise<void>((resolve, reject) => {
            pendingBatches.set(batchId, { reject, requestId, resolve });
            const message: RepositoryHistoryWorkerRequest = {
              _tag: "HistoryBatchReceived",
              batchId,
              bytes,
              requestId,
            };
            port.postMessage(message, [bytes.buffer]);
          });
        },
        controller.signal,
      )
      .then(
        (commitCount) => {
          port.postMessage({
            _tag: "HistorySynchronizationCompleted",
            commitCount,
            requestId,
          } satisfies RepositoryHistoryWorkerRequest);
        },
        (error: unknown) => {
          port.postMessage({
            _tag: "HistorySynchronizationFailed",
            failure: workerFailure(error),
            requestId,
          } satisfies RepositoryHistoryWorkerRequest);
        },
      )
      .finally(() => {
        synchronizations.delete(requestId);
        rejectSynchronizationBatches(requestId);
      });
  }

  function rejectSynchronizationBatches(requestId: string) {
    for (const [batchId, batch] of pendingBatches) {
      if (batch.requestId !== requestId) {
        continue;
      }
      batch.reject(new RepositoryHistoryUnavailable());
      pendingBatches.delete(batchId);
    }
  }

  function request<T>(message: RepositoryHistoryWorkerRequest) {
    if (closed) {
      return Promise.reject(new RepositoryHistoryUnavailable());
    }
    return new Promise<T>((resolve, reject) => {
      if (!("requestId" in message)) {
        reject(new RepositoryHistoryUnavailable());
        return;
      }
      pending.set(message.requestId, {
        reject,
        resolve: (value) => resolve(value as T),
      });
      port.postMessage(message);
    });
  }

  const reader: RepositoryHistoryReader = {
    locateMany: (query, oids) =>
      request<readonly RepositoryHistoryPosition[]>({
        _tag: "LocateHistoryCommits",
        query,
        oids,
        requestId: createRepositoryHistoryRequestId(),
      }),
    ancestryRoute: (roots, oid) =>
      request<HistoryAncestryRoute | undefined>({
        _tag: "GetAncestryRoute",
        roots,
        oid,
        requestId: createRepositoryHistoryRequestId(),
      }),
    locate: (query, oid) =>
      request<number | undefined>({
        _tag: "LocateHistoryCommit",
        query,
        oid,
        requestId: createRepositoryHistoryRequestId(),
      }),
    getCacheDiagnostics: () =>
      request<RepositoryHistoryStorageDiagnostics>({
        _tag: "GetCacheDiagnostics",
        requestId: createRepositoryHistoryRequestId(),
      }),
    manageCache: (action) =>
      request<void>({
        _tag: "ManageCache",
        action,
        requestId: createRepositoryHistoryRequestId(),
      }),
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      releaseLease();
      for (const controller of loads.values()) {
        controller.abort();
      }
      loads.clear();
      for (const controller of synchronizations.values()) {
        controller.abort();
      }
      synchronizations.clear();
      for (const batch of pendingBatches.values()) {
        batch.reject(new RepositoryHistoryUnavailable());
      }
      pendingBatches.clear();
      for (const current of pending.values()) {
        current.reject(new RepositoryHistoryUnavailable());
      }
      pending.clear();
      unsubscribeAvailability?.();
      port.postMessage({
        _tag: "CloseReader",
      } satisfies RepositoryHistoryWorkerRequest);
      port.close();
    },
    getCommitSummaries: (oids) =>
      request<readonly RepositoryCommit[]>({
        _tag: "GetCommitSummaries",
        oids,
        requestId: createRepositoryHistoryRequestId(),
      }),
    getRefTargets: () =>
      request<readonly RepositoryHistoryRefTarget[]>({
        _tag: "GetRefTargets",
        requestId: createRepositoryHistoryRequestId(),
      }),
    getSnapshot: () => snapshot,
    read: (query) =>
      request<readonly RepositoryCommit[]>({
        _tag: "ReadHistory",
        query,
        requestId: createRepositoryHistoryRequestId(),
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return reader;
}

function acquireSharedWorker() {
  sharedWorker ??= new SharedWorker(
    new URL("./repository-history-worker.ts", import.meta.url),
    { name: "rebase-repository-history", type: "module" },
  );
  return sharedWorker;
}

function readerError(
  failure: Extract<
    RepositoryHistoryWorkerResponse,
    { _tag: "RequestFailed" }
  >["failure"],
) {
  switch (failure._tag) {
    case "Rejected":
      return new RepositoryHistoryRejected({ failure: failure.detail });
    case "Offline":
      return new RepositoryHistoryOffline();
    case "StorageUnavailable":
      return new RepositoryHistoryStorageUnavailable();
    case "Unavailable":
      return new RepositoryHistoryUnavailable();
  }
}

function workerFailure(error: unknown): RepositoryHistoryWorkerFailure {
  if (error instanceof RepositoryHistoryRejected) {
    return { _tag: "Rejected", detail: error.failure };
  }
  if (error instanceof RepositoryHistoryStorageUnavailable) {
    return { _tag: "StorageUnavailable" };
  }
  if (error instanceof RepositoryHistoryUnavailable) {
    return { _tag: "Unavailable" };
  }
  if (error instanceof RepositoryHistoryOffline) {
    return { _tag: "Offline" };
  }
  return { _tag: "Offline" };
}

function requestPersistentStorage() {
  if (persistenceRequested) {
    return;
  }
  persistenceRequested = true;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
}

interface PendingRequest {
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: unknown) => void;
}

interface PendingBatch {
  readonly reject: (error: unknown) => void;
  readonly requestId: string;
  readonly resolve: () => void;
}
