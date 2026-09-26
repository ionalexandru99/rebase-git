import { currentEnvironmentProtocol } from "@rebase/contracts";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { Query } from "@tanstack/react-query";
import type {
  PersistedClient,
  PersistQueryClientOptions,
} from "@tanstack/react-query-persist-client";
import { createStore, del, get, set } from "idb-keyval";
import { persistOnlyChanges } from "#web/platform/query/persist-only-changes";

type EnvironmentQueryPersistence = Omit<
  PersistQueryClientOptions,
  "queryClient"
>;

export function createEnvironmentQueryPersistence(): EnvironmentQueryPersistence {
  const store = createStore("rebase-environment-queries", "clients");
  return {
    persister: persistOnlyChanges(
      createAsyncStoragePersister({
        key: "environment-queries",
        storage: {
          getItem: (key) => get<string>(key, store),
          setItem: (key, value) => set(key, value, store),
          removeItem: (key) => del(key, store),
        },
        deserialize: (value) => unconfirmedClient(JSON.parse(value)),
      }),
    ),
    buster: `protocol-${currentEnvironmentProtocol.major}`,
    maxAge: Number.POSITIVE_INFINITY,
    dehydrateOptions: { shouldDehydrateQuery: persistedQuery },
    hydrateOptions: {
      defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY } },
    },
  };
}

function persistedQuery(query: Query) {
  return query.meta?.persist === true && query.state.data !== undefined;
}

function unconfirmedClient(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => ({
        ...query,
        state: {
          ...query.state,
          status: "success",
          error: null,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          dataUpdateCount: 0,
          errorUpdateCount: 0,
          isInvalidated: true,
        },
      })),
    },
  };
}
