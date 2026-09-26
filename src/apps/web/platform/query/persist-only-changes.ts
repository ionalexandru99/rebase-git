import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

export function persistOnlyChanges(persister: Persister): Persister {
  let saved: string | undefined;
  return {
    persistClient: (client) => {
      const version = persistedVersion(client);
      if (version === saved) return;
      saved = version;
      return persister.persistClient(client);
    },
    restoreClient: persister.restoreClient,
    removeClient: () => {
      saved = undefined;
      return persister.removeClient();
    },
  };
}

const dataVersions = new WeakMap<object, number>();
let lastDataVersion = 0;

function persistedVersion(client: PersistedClient) {
  return client.clientState.queries
    .map(({ queryHash, state }) => `${queryHash}@${dataVersion(state.data)}`)
    .join("\n");
}

function dataVersion(data: unknown) {
  if (typeof data !== "object" || data === null) return JSON.stringify(data);
  const known = dataVersions.get(data);
  if (known !== undefined) return known;
  lastDataVersion += 1;
  dataVersions.set(data, lastDataVersion);
  return lastDataVersion;
}
