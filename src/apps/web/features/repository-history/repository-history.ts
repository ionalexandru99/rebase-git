import { useEffect, useState } from "react";
import type {
  HistoryAnswers,
  HistoryClientMessage,
  HistoryFailure,
  HistoryIdentity,
  HistoryQuery,
  HistorySnapshot,
  HistoryWorkerMessage,
} from "#web/features/repository-history/history-worker-protocol";
import type { EnvironmentAccess } from "#web/platform/environment/environment-connection";
import { describeFailure } from "#web/platform/query/request-failure";
import { createStore, type ReadableStore } from "#web/platform/store/store";

export interface RepositoryHistory extends ReadableStore<HistorySnapshot> {
  readonly ask: <Query extends HistoryQuery>(
    query: Query,
    signal?: AbortSignal,
  ) => Promise<HistoryAnswers[Query["_tag"]]>;
  readonly synchronize: () => void;
  readonly close: () => void;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (failure: HistoryFailure) => void;
}

export const emptyHistorySnapshot: HistorySnapshot = {
  revision: 0,
  status: "loading",
  synchronization: "idle",
  commitCount: 0,
  refTargets: [],
};

const opened = new Set<MessagePort>();
let environment: EnvironmentAccess | undefined;
let connection: MessagePort | undefined;
let sharedWorker: SharedWorker | undefined;
let persistenceRequested = false;

export function connectRepositoryHistory(access: EnvironmentAccess) {
  environment = access;
  try {
    connection ??= connectPort(acquireSharedWorker().port);
  } catch {
    return;
  }
  for (const port of [connection, ...opened])
    send(port, { _tag: "Connect", environment: access });
}

export function openRepositoryHistory(
  identity?: HistoryIdentity,
): RepositoryHistory {
  const store = createStore(emptyHistorySnapshot);
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let worker: SharedWorker | undefined;
  const fail = () => {
    for (const request of pending.values())
      request.reject({ _tag: "Unavailable" });
    pending.clear();
    store.set({
      ...store.getSnapshot(),
      status: "error",
      failure: { _tag: "Unavailable" },
    });
  };
  try {
    worker = acquireSharedWorker();
    worker.addEventListener("error", fail);
  } catch {
    fail();
  }
  const channel = worker === undefined ? undefined : connectPort(worker.port);
  if (channel !== undefined) {
    opened.add(channel);
    channel.onmessage = (event: MessageEvent<HistoryWorkerMessage>) => {
      const message = event.data;
      if (message._tag === "Snapshot") {
        store.set(message.snapshot);
        return;
      }
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message._tag === "Answer") request?.resolve(message.value);
      else request?.reject(message.failure);
    };
    channel.start();
    if (identity !== undefined) {
      requestPersistentStorage();
      send(channel, {
        _tag: "Open",
        identity,
        ...(environment === undefined ? {} : { environment }),
      });
    }
  }
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    ask: (query, signal) => {
      if (channel === undefined)
        return Promise.reject<never>({ _tag: "Unavailable" });
      signal?.throwIfAborted();
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        signal?.addEventListener(
          "abort",
          () => {
            pending.delete(id);
            send(channel, { _tag: "Cancel", id });
            reject(signal.reason);
          },
          { once: true },
        );
        send(channel, { _tag: "Ask", id, query });
      });
    },
    synchronize: () => {
      if (channel !== undefined) send(channel, { _tag: "Synchronize" });
    },
    close: () => {
      worker?.removeEventListener("error", fail);
      if (channel === undefined) return;
      opened.delete(channel);
      send(channel, { _tag: "Close" });
      channel.close();
      for (const request of pending.values())
        request.reject({ _tag: "Unavailable" });
      pending.clear();
    },
  };
}

export function useRepositoryHistory(identity: HistoryIdentity | undefined) {
  const environmentId = identity?.environmentId;
  const repositoryId = identity?.repositoryId;
  const logicalRepositoryId = identity?.logicalRepositoryId;
  const key = JSON.stringify([
    environmentId,
    repositoryId,
    logicalRepositoryId,
  ]);
  const [history, setHistory] = useState<{
    readonly key: string;
    readonly history: RepositoryHistory;
  }>();
  useEffect(() => {
    if (
      environmentId === undefined ||
      repositoryId === undefined ||
      logicalRepositoryId === undefined
    )
      return;
    const next = openRepositoryHistory({
      environmentId,
      repositoryId,
      logicalRepositoryId,
    });
    setHistory({ key, history: next });
    return () => next.close();
  }, [environmentId, repositoryId, logicalRepositoryId, key]);
  return history?.key === key ? history.history : undefined;
}

export function describeHistoryFailure(failure: HistoryFailure) {
  switch (failure._tag) {
    case "Offline":
    case "Unavailable":
      return "Commit history is unavailable while the Environment reconnects.";
    case "StorageUnavailable":
      return "This browser cannot store repository history.";
    case "Rejected":
      return describeFailure(failure);
  }
}

function connectPort(port: MessagePort) {
  const channel = new MessageChannel();
  port.postMessage(channel.port2, [channel.port2]);
  port.start();
  return channel.port1;
}

function send(port: MessagePort, message: HistoryClientMessage) {
  port.postMessage(message);
}

function acquireSharedWorker() {
  sharedWorker ??= new SharedWorker(
    new URL("./worker/history-worker.ts", import.meta.url),
    { name: "rebase-repository-history", type: "module" },
  );
  return sharedWorker;
}

function requestPersistentStorage() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
}
