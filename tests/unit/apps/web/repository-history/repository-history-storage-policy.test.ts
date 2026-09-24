import { describe, expect, it, vi } from "vitest";
import type { RepositoryHistoryCacheDiagnostics } from "#web/domain/repository-history/history-storage.contract";
import {
  historyCacheCleanupCandidates,
  writeHistoryWithCleanup,
} from "#web/features/repository-history/cache/repository-history-storage-policy";
import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";

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

  it("evicts caches until the write succeeds", async () => {
    const events: string[] = [];
    let attempt = 0;
    const result = await writeHistoryWithCleanup({
      write: async () => {
        events.push("write");
        if (attempt++ < 2) throw quotaError();
        return 12;
      },
      evictNext: async () => {
        events.push("evict");
        return true;
      },
    });
    expect(result).toBe(12);
    expect(events).toEqual(["write", "evict", "write", "evict", "write"]);
  });

  it("reports exhausted storage without discarding the failed batch", async () => {
    const error = quotaError();
    const write = vi.fn(async () => {
      throw error;
    });
    await expect(
      writeHistoryWithCleanup({ write, evictNext: async () => false }),
    ).rejects.toBe(error);
    expect(write).toHaveBeenCalledOnce();
  });

  it("leaves unrelated write failures alone", async () => {
    const evictNext = vi.fn(async () => true);
    const error = new Error("Disconnected");
    await expect(
      writeHistoryWithCleanup({
        write: async () => {
          throw error;
        },
        evictNext,
      }),
    ).rejects.toBe(error);
    expect(evictNext).not.toHaveBeenCalled();
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
