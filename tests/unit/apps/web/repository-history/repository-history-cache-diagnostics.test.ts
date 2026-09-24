import { describe, expect, it } from "vitest";
import { describeHistoryCaches } from "#web/features/repository-history/cache/repository-history-storage";
import type { StoredRepository } from "#web/persistence/repository-history/repository-history-database.contract";
import {
  emptyStoredRepository,
  repositoryKey,
} from "#web/persistence/repository-history/repository-history-records";

describe("history cache diagnostics", () => {
  it("splits origin usage across caches by their stored commit counts", () => {
    const caches = describeHistoryCaches(
      [repository(1, "large", 300), repository(2, "small", 100)],
      (key) => key === repositoryKey("environment", "small"),
      4_000,
    );
    expect(caches).toMatchObject([
      { repositoryId: "large", commitCount: 300, estimatedBytes: 3_000 },
      { repositoryId: "small", commitCount: 100, estimatedBytes: 1_000 },
    ]);
    expect(caches.map((cache) => cache.open)).toEqual([false, true]);
  });

  it("leaves sizes unknown when the browser does not report usage", () => {
    expect(
      describeHistoryCaches(
        [repository(1, "large", 300)],
        () => false,
        undefined,
      )[0],
    ).not.toHaveProperty("estimatedBytes");
  });
});

function repository(
  id: number,
  repositoryId: string,
  commitCount: number,
): StoredRepository {
  return {
    ...emptyStoredRepository("environment", repositoryId, "sha1"),
    id,
    commitCount,
  };
}
