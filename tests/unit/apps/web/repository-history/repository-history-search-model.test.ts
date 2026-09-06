import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";
import { createRepositoryHistorySearchModel } from "#web/features/repository-history/search/repository-history-search-model";

afterEach(() => vi.useRealTimers());

describe("history search typing", () => {
  it("waits for a pause and cancels a pending query when cleared", async () => {
    vi.useFakeTimers();
    const reader: RepositoryHistorySearch = {
      search: vi.fn(async () => ({
        commits: [],
        replicaComplete: true,
        synchronizedCommitCount: 0,
      })),
    };
    const model = createRepositoryHistorySearchModel(reader, async () => {});
    try {
      model.setText("fi");
      await vi.advanceTimersByTimeAsync(100);
      model.setText("fix");
      expect(model.getSnapshot().text).toBe("fix");
      await vi.advanceTimersByTimeAsync(199);
      expect(reader.search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reader.search).toHaveBeenCalledExactlyOnceWith(
        { text: "fix", limit: 20 },
        expect.any(AbortSignal),
      );
      model.setText("fixed");
      model.setText("");
      expect(model.getSnapshot().loading).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(reader.search).toHaveBeenCalledTimes(1);
    } finally {
      await model.dispose();
    }
  });
});
