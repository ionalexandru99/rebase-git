import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  EnvironmentChangeListener,
  EnvironmentChanges,
} from "#web/platform/environment/environment-protocol.contract";
import {
  invalidatedByChange,
  subscribeChangeInvalidation,
} from "#web/platform/query/environment-invalidation";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";

const refs = { changes: "refs", repositoryId: "one" } as const;
const index = { changes: "index", repositoryId: "one" } as const;

describe("environment change invalidation", () => {
  it("refreshes ref and index queries of the changed repositories on ref changes", () => {
    expect(invalidatedByChange(refs, ["one"], "Refs")).toBe(true);
    expect(invalidatedByChange(index, ["one"], "Refs")).toBe(true);
    expect(invalidatedByChange(refs, ["two"], "Refs")).toBe(false);
  });

  it("refreshes only index queries on index changes", () => {
    expect(invalidatedByChange(index, ["one"], "Index")).toBe(true);
    expect(invalidatedByChange(refs, ["one"], "Index")).toBe(false);
  });

  it("treats a change without repositories or kind as a change to everything it watches", () => {
    expect(invalidatedByChange(refs)).toBe(true);
    expect(invalidatedByChange({ changes: "refs", repositoryId: null })).toBe(
      true,
    );
    expect(invalidatedByChange({ changes: "none", repositoryId: "one" })).toBe(
      false,
    );
    expect(invalidatedByChange(undefined)).toBe(false);
  });

  it("reads once more after the read in flight when changes arrive during it", async () => {
    const queryClient = createEnvironmentQueryClient();
    const listeners = new Set<EnvironmentChangeListener>();
    const changes: EnvironmentChanges = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const responses: Array<(branches: readonly string[]) => void> = [];
    const read = vi.fn(
      () =>
        new Promise<readonly string[]>((resolve) => {
          responses.push(resolve);
        }),
    );
    const stopInvalidation = subscribeChangeInvalidation(queryClient, changes);
    const observer = new QueryObserver(queryClient, {
      queryKey: ["repository-refs", "one"],
      queryFn: read,
      meta: refs,
    });
    const change = () => {
      for (const listener of listeners) listener(["one"], "Refs");
    };
    const stopObserving = observer.subscribe(() => {});
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    responses[0]?.(["main"]);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual(["main"]),
    );

    change();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    for (let burst = 0; burst < 20; burst += 1) change();
    expect(read).toHaveBeenCalledTimes(2);
    responses[1]?.(["main", "stale"]);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    responses[2]?.(["main", "feature"]);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual(["main", "feature"]),
    );

    expect(read).toHaveBeenCalledTimes(3);
    stopObserving();
    stopInvalidation();
  });
});
