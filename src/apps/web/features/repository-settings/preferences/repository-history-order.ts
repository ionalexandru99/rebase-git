import type {
  RepositoryHistoryOrder,
  RepositorySettingsIdentity,
} from "#web/features/repository-settings/repository-settings.contract";

const listeners = new Map<string, Set<() => void>>();

function storageKey(identity: RepositorySettingsIdentity) {
  return `rebase:history-order:v1:${JSON.stringify([identity.environmentId, identity.repositoryId])}`;
}

export function readRepositoryHistoryOrder(
  identity: RepositorySettingsIdentity,
): RepositoryHistoryOrder {
  try {
    return localStorage.getItem(storageKey(identity)) === "chronological"
      ? "chronological"
      : "topological";
  } catch {
    return "topological";
  }
}

export function saveRepositoryHistoryOrder(
  identity: RepositorySettingsIdentity,
  order: RepositoryHistoryOrder,
) {
  const key = storageKey(identity);
  localStorage.setItem(key, order);
  for (const notify of listeners.get(key) ?? []) notify();
}

export function subscribeRepositoryHistoryOrder(
  identity: RepositorySettingsIdentity,
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
