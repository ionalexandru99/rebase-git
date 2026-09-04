import { describe, expect, it } from "vite-plus/test";
import {
  createBrowserHistoryFilterStore,
  historyFilterStorageKey,
} from "#web/features/commit-graph/browser-history-filter-store";
import { automaticHistoryScope } from "#web/features/commit-graph/history-scope";

const environmentId = "00000000-0000-4000-8000-000000000001";
const repositoryId = "00000000-0000-4000-8000-000000000002";

describe("browser history filter store", () => {
  it("persists typed selections per environment and logical repository", () => {
    const storage = memoryStorage();
    const store = createBrowserHistoryFilterStore(storage);
    const custom = {
      _tag: "Custom",
      selections: [
        { _tag: "LocalBranch", name: "main" },
        { _tag: "RemoteBranch", name: "release", remote: "origin" },
        { _tag: "Tag", name: "v1.0.0" },
      ],
    } as const;

    store.save(environmentId, repositoryId, custom);

    expect(store.load(environmentId, repositoryId)).toEqual(custom);
    expect(
      store.load(environmentId, "00000000-0000-4000-8000-000000000003"),
    ).toEqual(automaticHistoryScope);
  });

  it("falls back to Automatic for corrupt or invalid state", () => {
    const storage = memoryStorage();
    const store = createBrowserHistoryFilterStore(storage);
    const key = historyFilterStorageKey(environmentId, repositoryId);

    storage.setItem(key, "not json");
    expect(store.load(environmentId, repositoryId)).toEqual(
      automaticHistoryScope,
    );

    storage.setItem(
      key,
      JSON.stringify({ version: 1, scope: { _tag: "Custom", selections: [] } }),
    );
    expect(store.load(environmentId, repositoryId)).toEqual(
      automaticHistoryScope,
    );
  });

  it("keeps working in memory when browser storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new DOMException("denied");
      },
      setItem: () => {
        throw new DOMException("denied");
      },
    };
    const store = createBrowserHistoryFilterStore(storage);

    expect(store.load(environmentId, repositoryId)).toEqual(
      automaticHistoryScope,
    );
    expect(() =>
      store.save(environmentId, repositoryId, {
        _tag: "Custom",
        selections: [{ _tag: "Tag", name: "v1" }],
      }),
    ).not.toThrow();
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
