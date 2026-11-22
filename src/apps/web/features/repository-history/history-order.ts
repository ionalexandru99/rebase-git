import type { HistoryOrder } from "#web/features/repository-history/history-graph.ts";
import { createStore, type Store } from "#web/platform/store/store.ts";
import { createStoredStore } from "#web/platform/store/stored-store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export interface RepositoryHistoryIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}

const stores = new Map<string, Store<HistoryOrder>>();
const unknownRepository = createStore<HistoryOrder>("topological");

export function saveRepositoryHistoryOrder(
  identity: RepositoryHistoryIdentity,
  order: HistoryOrder,
) {
  orderStore(identity).set(order);
}

export function useRepositoryHistoryOrder(
  environmentId: string | undefined,
  repositoryId: string | undefined,
) {
  return useStore(
    environmentId === undefined || repositoryId === undefined
      ? unknownRepository
      : orderStore({ environmentId, repositoryId }),
  );
}

function orderStore(identity: RepositoryHistoryIdentity) {
  const key = `rebase:history-order:v1:${JSON.stringify([identity.environmentId, identity.repositoryId])}`;
  const existing = stores.get(key);
  if (existing !== undefined) return existing;
  const store = createStoredStore(
    key,
    (saved): HistoryOrder =>
      saved === "chronological" ? "chronological" : "topological",
    { followOtherWindows: true },
  );
  stores.set(key, store);
  return store;
}
