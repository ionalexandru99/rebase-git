import { afterEach, describe, expect, it } from "vitest";
import {
  createBrowserHistoryFilterStore,
  historyFilterStorageKey,
} from "#web/features/commit-graph/scope/browser-history-filter-store";
import { automaticHistoryScope } from "#web/features/commit-graph/scope/history-scope";

const environmentId = "00000000-0000-4000-8000-000000000001";
const logicalRepositoryId = "00000000-0000-4000-8000-000000000002";

afterEach(() => {
  localStorage.removeItem(
    historyFilterStorageKey(environmentId, logicalRepositoryId),
  );
});

describe("browser history filter storage", () => {
  it("restores the last real change without changing an open tab", () => {
    const firstTab = createBrowserHistoryFilterStore();
    const secondTab = createBrowserHistoryFilterStore();
    const firstTabState = firstTab.load(environmentId, logicalRepositoryId);
    const secondTabState = secondTab.load(environmentId, logicalRepositoryId);
    const firstChange = {
      _tag: "Custom",
      selections: [{ _tag: "LocalBranch", name: "main" }],
    } as const;
    const secondChange = {
      _tag: "Custom",
      selections: [{ _tag: "Tag", name: "v1.0.0" }],
    } as const;

    firstTab.save(environmentId, logicalRepositoryId, firstChange);
    expect(firstTabState).toEqual(automaticHistoryScope);
    expect(secondTabState).toEqual(automaticHistoryScope);

    secondTab.save(environmentId, logicalRepositoryId, secondChange);
    expect(
      createBrowserHistoryFilterStore().load(
        environmentId,
        logicalRepositoryId,
      ),
    ).toEqual(secondChange);
  });

  it("shares one key across linked worktree views", () => {
    const mainWorktree = createBrowserHistoryFilterStore();
    const linkedWorktree = createBrowserHistoryFilterStore();
    const filter = {
      _tag: "Custom",
      selections: [{ _tag: "RemoteBranch", name: "main", remote: "origin" }],
    } as const;

    mainWorktree.save(environmentId, logicalRepositoryId, filter);

    expect(linkedWorktree.load(environmentId, logicalRepositoryId)).toEqual(
      filter,
    );
  });
});
