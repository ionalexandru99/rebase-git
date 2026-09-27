import { useEffect, useState } from "react";
import {
  holdLease,
  watchLease,
} from "#web/features/repository-history/history-lease";
import type {
  HistoryAnswers,
  HistoryClientMessage,
  HistoryFailure,
  HistoryIdentity,
  HistoryPortOffer,
  HistoryQuery,
  HistorySnapshot,
  HistoryWorkerLease,
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

interface SharedHistoryWorker {
  readonly worker: SharedWorker;
  readonly lost: Set<() => void>;
  connection?: MessagePort;
}

const opened = new Set<MessagePort>();
let environment: EnvironmentAccess | undefined;
let shared: SharedHistoryWorker | undefined;
let pageLease: Promise<string | undefined> | undefined;
let persistenceRequested = false;

export function connectRepositoryHistory(access: EnvironmentAccess) {
  environment = access;
  let current: SharedHistoryWorker;
  try {
    current = acquireSharedWorker();
  } catch {
    return;
  }
  current.connection ??= connectPort(current);
  for (const port of [current.connection, ...opened])
    send(port, { _tag: "Connect", environment: access });
}

export function openRepositoryHistory(
  identity?: HistoryIdentity,
): RepositoryHistory {
  const store = createStore(emptyHistorySnapshot);
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let link:
    | { readonly worker: SharedHistoryWorker; readonly channel: MessagePort }
    | undefined;
  const detach = () => {
    if (link === undefined) return;
    link.worker.lost.delete(lose);
    opened.delete(link.channel);
    link.channel.close();
    link = undefined;
    for (const request of pending.values())
      request.reject({ _tag: "Unavailable" });
    pending.clear();
  };
  const lose = () => {
    detach();
    store.set({
      ...store.getSnapshot(),
      status: "error",
      failure: { _tag: "Unavailable" },
    });
  };
  const attach = () => {
    let worker: SharedHistoryWorker;
    try {
      worker = acquireSharedWorker();
    } catch {
      lose();
      return;
    }
    const channel = connectPort(worker);
    link = { worker, channel };
    worker.lost.add(lose);
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
  };
  attach();
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    ask: (query, signal) => {
      const channel = link?.channel;
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
      if (link === undefined) attach();
      else send(link.channel, { _tag: "Synchronize" });
    },
    close: () => {
      if (link !== undefined) send(link.channel, { _tag: "Close" });
      detach();
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

function connectPort(current: SharedHistoryWorker) {
  const channel = new MessageChannel();
  pageLease ??= holdLease("rebase-history-page");
  void pageLease.then((lease) =>
    current.worker.port.postMessage(
      (lease === undefined ? {} : { lease }) satisfies HistoryPortOffer,
      [channel.port2],
    ),
  );
  return channel.port1;
}

function send(port: MessagePort, message: HistoryClientMessage) {
  port.postMessage(message);
}

function acquireSharedWorker() {
  if (shared !== undefined) return shared;
  const current: SharedHistoryWorker = {
    worker: new SharedWorker(
      new URL("./worker/history-worker.ts", import.meta.url),
      { name: "rebase-repository-history", type: "module" },
    ),
    lost: new Set(),
  };
  const lose = () => {
    if (shared !== current) return;
    shared = undefined;
    for (const lost of [...current.lost]) lost();
  };
  current.worker.addEventListener("error", lose);
  current.worker.port.onmessage = (event: MessageEvent<HistoryWorkerLease>) =>
    watchLease(event.data.lease, lose);
  current.worker.port.start();
  shared = current;
  return current;
}

function requestPersistentStorage() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
}
