import type {
  RepositoryCommit,
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts";
import type { HistoryAncestryRoute } from "#web/features/repository-history/query/history-order.contract";
import { holdRepositoryHistoryReaderLease } from "#web/features/repository-history/reader/repository-history-reader-lease";
import { maintainRepositoryHistoryReader } from "#web/features/repository-history/reader/repository-history-reader-lifecycle";
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
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";
import type { RepositoryHistorySearchResult } from "#web/features/repository-history/search/repository-history-search.contract";
import { createRepositoryHistoryRequestId } from "#web/features/repository-history/transport/repository-history-request-id";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerFailure,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";

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
  let worker: SharedWorker | undefined;
  try {
    worker = options.worker ?? acquireSharedWorker();
  } catch {
    worker = undefined;
  }
  requestPersistentStorage();
  const channel = new MessageChannel();
  const port = channel.port1;
  const listeners = new Set<() => void>();
  const pending = new Map<string, PendingRequest>();
  const loads = new Map<string, AbortController>();
  const synchronizations = new Map<string, AbortController>();
  const pendingBatches = new Map<string, PendingBatch>();
  const freshnessCommands = new Map<string, AbortController>();
  let unsubscribeFreshness: (() => void) | undefined;
  let closed = false;
  let releaseLease = () => {};
  let unsubscribeAvailability: (() => void) | undefined;
  let snapshot: RepositoryHistorySnapshot = {
    revision: 0,
    historyRevision: 0,
    status: "empty",
  };

  port.onmessage = (event: MessageEvent<RepositoryHistoryWorkerResponse>) => {
    const message = event.data;
    if (message._tag === "WorkerFailed") {
      failWorker();
      return;
    }
    if (message._tag === "SubscribeFreshness") {
      unsubscribeFreshness?.();
      unsubscribeFreshness = options.gateway.freshness?.subscribe(
        options.repositoryId,
        (freshness) =>
          port.postMessage({
            _tag: "FreshnessChanged",
            freshness,
          } satisfies RepositoryHistoryWorkerRequest),
        (error) =>
          port.postMessage({
            _tag: "FreshnessFailed",
            failure: workerFailure(error),
          } satisfies RepositoryHistoryWorkerRequest),
      );
      return;
    }
    if (message._tag === "UnsubscribeFreshness") {
      unsubscribeFreshness?.();
      unsubscribeFreshness = undefined;
      return;
    }
    if (
      message._tag === "RunFetchHistory" ||
      message._tag === "RunConfigureFetch"
    ) {
      runFreshnessCommand(message);
      return;
    }
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
        shallowOids: message.shallowOids ?? [],
        ...(message.freshness === undefined
          ? {}
          : { freshness: message.freshness }),
        ...(message.freshnessFailure === undefined
          ? {}
          : { freshnessError: readerError(message.freshnessFailure) }),
        storingCommits: message.storingCommits ?? false,
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
    if (message._tag === "HistorySearchCanceled") {
      request.reject(
        new DOMException("History search was canceled", "AbortError"),
      );
      return;
    }
    if (message._tag === "HistorySearchResult") {
      request.resolve(message.result);
      return;
    }
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
    if (message._tag === "FreshnessResult") {
      request.resolve(message.freshness);
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
  function failWorker() {
    if (closed) return;
    if (sharedWorker === worker) sharedWorker = undefined;
    dispose();
    worker?.port.close();
    snapshot = {
      ...snapshot,
      revision: snapshot.revision + 1,
      status: "error",
      synchronization: "idle",
      storingCommits: false,
      error: new RepositoryHistoryUnavailable(),
    };
    for (const listener of listeners) listener();
  }

  worker?.addEventListener("error", failWorker);
  port.addEventListener("messageerror", failWorker);
  releaseLease = holdRepositoryHistoryReaderLease((lifetimeLock) => {
    if (closed) return;
    const connection: ConnectRepositoryHistoryReader = {
      _tag: "ConnectRepositoryHistoryReader",
      environmentId: options.environmentId,
      logicalRepositoryId: options.logicalRepositoryId ?? options.repositoryId,
      cachePaused,
      ...(lifetimeLock === undefined ? {} : { lifetimeLock }),
      port: channel.port2,
      repositoryId: options.repositoryId,
      supportsFreshness: options.gateway.freshness !== undefined,
    };
    try {
      if (worker === undefined) throw new RepositoryHistoryUnavailable();
      worker.port.postMessage(connection, [channel.port2]);
      worker.port.start();
    } catch {
      queueMicrotask(failWorker);
    }
  });
  unsubscribeAvailability = options.gateway.subscribeAvailability?.(() => {
    port.postMessage({
      _tag: "ReconcileHistory",
    } satisfies RepositoryHistoryWorkerRequest);
  });

  function dispose() {
    if (closed) return;
    closed = true;
    worker?.removeEventListener("error", failWorker);
    port.removeEventListener("messageerror", failWorker);
    port.onmessage = null;
    releaseLease();
    unsubscribeFreshness?.();
    unsubscribeFreshness = undefined;
    for (const controller of freshnessCommands.values()) controller.abort();
    freshnessCommands.clear();
    for (const controller of loads.values()) controller.abort();
    loads.clear();
    for (const controller of synchronizations.values()) controller.abort();
    synchronizations.clear();
    for (const batch of pendingBatches.values())
      batch.reject(new RepositoryHistoryUnavailable());
    pendingBatches.clear();
    for (const current of pending.values())
      current.reject(new RepositoryHistoryUnavailable());
    pending.clear();
    unsubscribeAvailability?.();
    port.postMessage({
      _tag: "CloseReader",
    } satisfies RepositoryHistoryWorkerRequest);
    port.close();
    channel.port2.close();
  }

  function runFreshnessCommand(
    message: Extract<
      RepositoryHistoryWorkerResponse,
      { _tag: "RunFetchHistory" | "RunConfigureFetch" }
    >,
  ) {
    const controller = new AbortController();
    freshnessCommands.set(message.requestId, controller);
    const gateway = options.gateway.freshness;
    const operation =
      gateway === undefined
        ? Promise.reject(new RepositoryHistoryUnavailable())
        : message._tag === "RunFetchHistory"
          ? gateway.fetch(options.repositoryId, controller.signal)
          : gateway.configure(
              options.repositoryId,
              message.setting,
              controller.signal,
            );
    void operation
      .then(
        (freshness) => {
          if (!closed)
            port.postMessage({
              _tag: "FreshnessCommandCompleted",
              requestId: message.requestId,
              freshness,
            } satisfies RepositoryHistoryWorkerRequest);
        },
        (error: unknown) => {
          if (!closed)
            port.postMessage({
              _tag: "FreshnessCommandFailed",
              requestId: message.requestId,
              failure: workerFailure(error),
            } satisfies RepositoryHistoryWorkerRequest);
        },
      )
      .finally(() => freshnessCommands.delete(message.requestId));
  }

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
          ...(query.offset === undefined ? {} : { offset: query.offset }),
          ...(query.ancestry === undefined ? {} : { ancestry: query.ancestry }),
          ...(query.additionalParentEdges === undefined
            ? {}
            : { additionalParentEdges: query.additionalParentEdges }),
        },
        controller.signal,
      )
      .then(
        (bytes) => {
          if (closed) return;
          const message: RepositoryHistoryWorkerRequest = {
            _tag: "HistoryPageReceived",
            bytes,
            requestId,
          };
          port.postMessage(message, [bytes.buffer]);
        },
        (error: unknown) => {
          if (closed) return;
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
          if (closed) return Promise.reject(new RepositoryHistoryUnavailable());
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
          if (closed) return;
          port.postMessage({
            _tag: "HistorySynchronizationCompleted",
            commitCount,
            requestId,
          } satisfies RepositoryHistoryWorkerRequest);
        },
        (error: unknown) => {
          if (closed) return;
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

  function request<T>(
    message: RepositoryHistoryWorkerRequest,
    signal?: AbortSignal,
  ) {
    if (closed) {
      return Promise.reject(new RepositoryHistoryUnavailable());
    }
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      if (!("requestId" in message)) {
        reject(new RepositoryHistoryUnavailable());
        return;
      }
      const abort = () => {
        pending.delete(message.requestId);
        if (message._tag === "SearchHistory")
          port.postMessage({
            _tag: "CancelHistorySearch",
            requestId: message.requestId,
          } satisfies RepositoryHistoryWorkerRequest);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      pending.set(message.requestId, {
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
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
    fetch: () =>
      request<RepositoryFreshness>({
        _tag: "FetchHistory",
        requestId: createRepositoryHistoryRequestId(),
      }),
    configureFetch: (setting: RepositoryFetchSetting) =>
      request<RepositoryFreshness>({
        _tag: "ConfigureFetch",
        setting,
        requestId: createRepositoryHistoryRequestId(),
      }),
    search: (query, signal) =>
      request<RepositoryHistorySearchResult>(
        {
          _tag: "SearchHistory",
          query,
          requestId: createRepositoryHistoryRequestId(),
        },
        signal,
      ),
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
    close: dispose,
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
    new URL("./worker/repository-history-worker.ts", import.meta.url),
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
