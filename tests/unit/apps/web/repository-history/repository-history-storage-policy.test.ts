import { describe, expect, it, vi } from "vitest";
import {
  historyCacheCleanupCandidates,
  writeHistoryWithCleanup,
} from "#web/features/repository-history/cache/repository-history-storage-policy";
import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistoryCacheDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

describe("history cache cleanup", () => {
  it("evicts complete closed repositories in last-opened order across environments", () => {
    expect(
      historyCacheCleanupCandidates([
        cache("new", 30),
        { ...cache("open", 1), open: true },
        { ...cache("partial", 2), state: "partial" },
        cache("old", 10),
      ]).map((candidate) => candidate.repositoryId),
    ).toEqual(["old", "new"]);
  });

  it("prunes before eviction and stops as soon as the write succeeds", async () => {
    const events: string[] = [];
    let attempt = 0;
    const result = await writeHistoryWithCleanup({
      write: async () => {
        events.push("write");
        if (attempt++ < 2) throw quotaError();
        return 12;
      },
      prune: async () => {
        events.push("prune");
      },
      evictNext: async () => {
        events.push("evict");
        return true;
      },
    });
    expect(result).toBe(12);
    expect(events).toEqual(["write", "prune", "write", "evict", "write"]);
  });

  it("reports exhausted storage without discarding the failed batch", async () => {
    const error = quotaError();
    const write = vi.fn(async () => {
      throw error;
    });
    await expect(
      writeHistoryWithCleanup({
        write,
        prune: async () => undefined,
        evictNext: async () => false,
      }),
    ).rejects.toBe(error);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("leaves unrelated write failures alone", async () => {
    const prune = vi.fn();
    const error = new Error("Disconnected");
    await expect(
      writeHistoryWithCleanup({
        write: async () => {
          throw error;
        },
        prune,
        evictNext: async () => true,
      }),
    ).rejects.toBe(error);
    expect(prune).not.toHaveBeenCalled();
  });
});

function quotaError() {
  return new RepositoryHistoryStorageUnavailable({
    cause: new DOMException("Quota exceeded", "QuotaExceededError"),
  });
}

function cache(
  repositoryId: string,
  lastOpenedAt: number,
): RepositoryHistoryCacheDiagnostics {
  return {
    repositoryId,
    lastOpenedAt,
    environmentId: "environment",
    open: false,
    state: "complete",
    commitCount: 2,
    estimatedBytes: 100,
  };
}
