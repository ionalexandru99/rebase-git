import { useCallback, useSyncExternalStore } from "react";
import type { HistoryOrder } from "#web/features/repository-history/history-graph";

export interface RepositoryHistoryIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}

const listeners = new Map<string, Set<() => void>>();

function storageKey(identity: RepositoryHistoryIdentity) {
  return `rebase:history-order:v1:${JSON.stringify([identity.environmentId, identity.repositoryId])}`;
}

function readRepositoryHistoryOrder(
  identity: RepositoryHistoryIdentity,
): HistoryOrder {
  try {
    return localStorage.getItem(storageKey(identity)) === "chronological"
      ? "chronological"
      : "topological";
  } catch {
    return "topological";
  }
}

export function saveRepositoryHistoryOrder(
  identity: RepositoryHistoryIdentity,
  order: HistoryOrder,
) {
  const key = storageKey(identity);
  localStorage.setItem(key, order);
  for (const notify of listeners.get(key) ?? []) notify();
}

function subscribeRepositoryHistoryOrder(
  identity: RepositoryHistoryIdentity,
  notify: () => void,
) {
  const key = storageKey(identity);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(notify);
  listeners.set(key, subscribers);
  const onStorage = (event: StorageEvent) => {
    if (
      event.storageArea === localStorage &&
      (event.key === key || event.key === null)
    )
      notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) listeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}

export function useRepositoryHistoryOrder(
  environmentId: string | undefined,
  repositoryId: string | undefined,
) {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (environmentId === undefined || repositoryId === undefined)
        return () => {};
      return subscribeRepositoryHistoryOrder(
        { environmentId, repositoryId },
        notify,
      );
    },
    [environmentId, repositoryId],
  );
  const getSnapshot = useCallback(
    () =>
      environmentId === undefined || repositoryId === undefined
        ? ("topological" as const)
        : readRepositoryHistoryOrder({ environmentId, repositoryId }),
    [environmentId, repositoryId],
  );
  return useSyncExternalStore(subscribe, getSnapshot);
}
