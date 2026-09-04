import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
  type RepositoryHistoryPage,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  repositoryKey,
  repositoryStoreName,
  requestResult,
  type StoredRepository,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import { readRepositoryCommits } from "#web/features/repository-history/repository-history-query";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
  RepositoryHistoryStorageUnavailable,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import {
  clearHistoryCache,
  describeHistoryCaches,
  markHistoryCacheOpened,
  pruneHistoryCache,
  readHistoryCacheRecords,
} from "#web/features/repository-history/repository-history-storage";
import { writeHistoryUnderPressure } from "#web/features/repository-history/repository-history-storage-maintenance";
import {
  completeStoredRepositoryHistory,
  readStoredRepositoryHistoryState,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

describe("history cache storage", () => {
  it("restores every reader after a failed cache clear", async () => {
    const fixture = await seed();
    const worker = new SharedWorker(
      new URL("./fixtures/history-cache-failure-worker.ts", import.meta.url),
      { type: "module", name: crypto.randomUUID() },
    );
    const gateway = gatewayFor(fixture);
    const options = {
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway,
      worker,
    };
    const first = createBrowserRepositoryHistoryReader(options);
    const second = createBrowserRepositoryHistoryReader(options);
    try {
      await second.getRefTargets();
      await expect(first.manageCache("clear")).rejects.toBeInstanceOf(
        RepositoryHistoryStorageUnavailable,
      );
      await vi.waitFor(() => expect(second.getSnapshot().status).toBe("error"));
      const query = {
        limit: 100,
        order: "topological" as const,
        roots: fixture.roots,
      };
      await expect(first.read(query)).resolves.toEqual(fixture.commits);
      await expect(second.read(query)).resolves.toEqual(fixture.commits);
      expect(gateway.read).not.toHaveBeenCalled();
    } finally {
      first.close();
      second.close();
      worker.port.close();
    }
  });

  it("preserves a cache opened while eviction awaits its transaction", async () => {
    const fixture = await seed();
    let opened = false;
    const clearing = clearHistoryCache(
      fixture.environmentId,
      fixture.repositoryId,
      true,
      indexedDB,
      () => opened,
    );
    opened = true;
    await expect(clearing).resolves.toBe(false);
    await expect(
      readRepositoryCommits(
        fixture.environmentId,
        fixture.repositoryId,
        fixture.commits.map((commit) => commit.oid),
      ),
    ).resolves.toEqual(fixture.commits);
    expect(
      await readStoredRepositoryHistoryState(
        fixture.environmentId,
        fixture.repositoryId,
      ),
    ).toBeDefined();
  });

  it("clears and rebuilds a shared repository through its reader", async () => {
    const fixture = await seed();
    const firstRepositoryId = crypto.randomUUID();
    const secondRepositoryId = crypto.randomUUID();
    const gateway = gatewayFor({
      ...fixture,
      repositoryId: firstRepositoryId,
      page: { ...fixture.page, repositoryId: firstRepositoryId },
    });
    const options = {
      environmentId: fixture.environmentId,
      logicalRepositoryId: fixture.repositoryId,
      repositoryId: firstRepositoryId,
      gateway,
    };
    const first = createBrowserRepositoryHistoryReader(options);
    const second = createBrowserRepositoryHistoryReader({
      ...options,
      repositoryId: secondRepositoryId,
    });
    const query = {
      limit: 100,
      order: "topological" as const,
      roots: fixture.roots,
    };
    await first.read(query);
    await vi.waitFor(() => {
      expect(gateway.synchronize).toHaveBeenCalledOnce();
      expect(first.getSnapshot().synchronization).toBe("complete");
    });
    const diagnostics = await first.getCacheDiagnostics();
    expect(
      diagnostics.caches.find(
        (cache) => cache.repositoryId === fixture.repositoryId,
      ),
    ).toMatchObject({ state: "complete", commitCount: 3, open: true });

    const historyRevision = first.getSnapshot().historyRevision;
    await first.read({ ...query, order: "chronological" });
    expect(first.getSnapshot().historyRevision).toBe(historyRevision);

    await first.manageCache("clear");
    await expect(second.read(query)).resolves.toEqual([]);
    expect(second.getSnapshot()).toMatchObject({
      status: "empty",
      synchronizedCommitCount: 0,
    });
    expect(second.getSnapshot().historyRevision).toBeGreaterThan(
      historyRevision,
    );
    const clearedRevision = second.getSnapshot().historyRevision;
    await first.manageCache("rebuild");
    await vi.waitFor(() =>
      expect(second.getSnapshot().synchronization).toBe("complete"),
    );
    expect(gateway.read).toHaveBeenCalledOnce();
    expect(second.getSnapshot().historyRevision).toBeGreaterThan(
      clearedRevision,
    );
    await expect(
      second.getCommitSummaries([fixture.orphan.oid]),
    ).resolves.toEqual([fixture.orphan]);
    first.close();
    second.close();
  });

  it("removal cancels every reader and deletes its cache", async () => {
    const fixture = await seed();
    const options = {
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway: gatewayFor(fixture),
    };
    const first = createBrowserRepositoryHistoryReader(options);
    const second = createBrowserRepositoryHistoryReader(options);
    await second.getRefTargets();
    await first.manageCache("remove");
    await vi.waitFor(async () => {
      await expect(second.getCommitSummaries([])).rejects.toBeInstanceOf(
        RepositoryHistoryUnavailable,
      );
    });
    expect(
      await readStoredRepositoryHistoryState(
        fixture.environmentId,
        fixture.repositoryId,
      ),
    ).toBeUndefined();
    first.close();
    second.close();
  });

  it("rebuild failure keeps the reader recoverable", async () => {
    const fixture = await seed();
    const gateway = gatewayFor(fixture);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway,
    });
    await reader.read({
      limit: 100,
      order: "topological",
      roots: fixture.roots,
    });
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );
    gateway.read.mockRejectedValueOnce(new RepositoryHistoryOffline());
    await reader.manageCache("rebuild");
    await vi.waitFor(() => expect(reader.getSnapshot().status).toBe("error"));
    await reader.manageCache("rebuild");
    await vi.waitFor(() =>
      expect(reader.getSnapshot().synchronization).toBe("complete"),
    );
    reader.close();
  });

  it("keeps a later clear when another tab has just requested a rebuild", async () => {
    const fixture = await seed();
    const options = {
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway: gatewayFor(fixture),
    };
    const first = createBrowserRepositoryHistoryReader(options);
    const second = createBrowserRepositoryHistoryReader(options);
    const query = {
      limit: 100,
      order: "topological" as const,
      roots: fixture.roots,
    };
    await first.read(query);
    await first.manageCache("rebuild");
    await second.manageCache("clear");
    await expect(first.read(query)).resolves.toEqual([]);
    await expect(
      second.getCommitSummaries(fixture.commits.map((commit) => commit.oid)),
    ).resolves.toEqual([]);
    first.close();
    second.close();
  });

  it("retries a quota-limited write after pruning real IndexedDB records", async () => {
    const fixture = await seed();
    let writes = 0;
    await writeHistoryUnderPressure(
      async () => {
        writes += 1;
        const orphan = await readRepositoryCommits(
          fixture.environmentId,
          fixture.repositoryId,
          [fixture.orphan.oid],
        );
        if (orphan.length > 0)
          throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      (key) => key !== fixture.key,
    );
    expect(writes).toBe(2);
    expect(
      await readStoredRepositoryHistoryState(
        fixture.environmentId,
        fixture.repositoryId,
      ),
    ).toBeDefined();
  });

  it("evicts the oldest complete closed cache after pruning cannot free enough", async () => {
    const oldest = await seed();
    const newest = await seed();
    const protectedCache = await seed();
    await markHistoryCacheOpened(newest.environmentId, newest.repositoryId);
    let writes = 0;
    await writeHistoryUnderPressure(
      async () => {
        writes += 1;
        if (
          await readStoredRepositoryHistoryState(
            oldest.environmentId,
            oldest.repositoryId,
          )
        )
          throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      (key) => key !== oldest.key && key !== newest.key,
    );
    expect(writes).toBe(3);
    expect(
      await readStoredRepositoryHistoryState(
        newest.environmentId,
        newest.repositoryId,
      ),
    ).toBeDefined();
    expect(
      await readRepositoryCommits(
        protectedCache.environmentId,
        protectedCache.repositoryId,
        [protectedCache.orphan.oid],
      ),
    ).toEqual([protectedCache.orphan]);
  });

  it("keeps committed data when storage is exhausted and every cache is open", async () => {
    const fixture = await seed();
    const error = new DOMException("Quota exceeded", "QuotaExceededError");
    await expect(
      writeHistoryUnderPressure(
        async () => {
          throw error;
        },
        () => true,
      ),
    ).rejects.toBe(error);
    expect(
      await readRepositoryCommits(
        fixture.environmentId,
        fixture.repositoryId,
        fixture.commits.map((commit) => commit.oid),
      ),
    ).toEqual(fixture.commits);
  });

  it("clears all caches while retaining open reader handles", async () => {
    const first = await seed();
    const second = await seed();
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: first.environmentId,
      repositoryId: first.repositoryId,
      gateway: gatewayFor(first),
    });
    await reader.getRefTargets();
    await reader.manageCache("clear-all");
    expect(
      await readRepositoryCommits(
        second.environmentId,
        second.repositoryId,
        second.commits.map((commit) => commit.oid),
      ),
    ).toEqual([]);
    const diagnostics = await reader.getCacheDiagnostics();
    expect(diagnostics.caches.every((cache) => cache.commitCount === 0)).toBe(
      true,
    );
    reader.close();
  });
  it("counts stored bytes and commits and retains identity when cleared", async () => {
    const fixture = await seed();
    await markHistoryCacheOpened(fixture.environmentId, fixture.repositoryId);
    const diagnostics = (
      await describeHistoryCaches((key) => key === fixture.key)
    ).find((cache) => cache.repositoryId === fixture.repositoryId);
    expect(diagnostics).toMatchObject({
      state: "complete",
      open: true,
      commitCount: 3,
    });
    expect(diagnostics?.estimatedBytes).toBeGreaterThan(0);
    expect(diagnostics?.lastOpenedAt).toBeGreaterThan(0);

    await clearHistoryCache(fixture.environmentId, fixture.repositoryId, false);
    expect(
      await readRepositoryCommits(
        fixture.environmentId,
        fixture.repositoryId,
        fixture.commits.map((commit) => commit.oid),
      ),
    ).toEqual([]);
    expect(
      await readStoredRepositoryHistoryState(
        fixture.environmentId,
        fixture.repositoryId,
      ),
    ).toMatchObject({
      objectFormat: "sha1",
      progress: { committedCommitCount: 0 },
      refTargets: [],
    });
  });

  it("removes unreachable commits while protecting every open repository", async () => {
    const fixture = await seed();
    const record = (await readHistoryCacheRecords()).find(
      (record) => record.key === fixture.key,
    );
    if (record === undefined) throw new Error("Missing fixture");
    await pruneHistoryCache(record, () => true);
    expect(
      await readRepositoryCommits(fixture.environmentId, fixture.repositoryId, [
        fixture.orphan.oid,
      ]),
    ).toEqual([fixture.orphan]);

    await pruneHistoryCache(record, () => false);
    expect(
      await readRepositoryCommits(
        fixture.environmentId,
        fixture.repositoryId,
        fixture.commits.map((commit) => commit.oid),
      ),
    ).toEqual(fixture.commits.slice(0, 2));
    expect(
      (
        await readStoredRepositoryHistoryState(
          fixture.environmentId,
          fixture.repositoryId,
        )
      )?.completion,
    ).toBeDefined();
  });

  it("removes only the requested environment and repository identity", async () => {
    const first = await seed();
    const second = await seed(first.repositoryId);
    await clearHistoryCache(first.environmentId, first.repositoryId, true);
    expect(
      await readStoredRepositoryHistoryState(
        first.environmentId,
        first.repositoryId,
      ),
    ).toBeUndefined();
    expect(
      await readRepositoryCommits(
        second.environmentId,
        second.repositoryId,
        second.commits.map((commit) => commit.oid),
      ),
    ).toEqual(second.commits);
  });

  it("reconciles a delta from the actual remaining count after pruning", async () => {
    const fixture = await seed();
    const extra = {
      ...fixture.orphan,
      oid: "e".repeat(40),
      subject: "Foreground-only orphan",
    };
    await storeRepositoryHistoryPage(
      fixture.environmentId,
      fixture.repositoryId,
      { ...fixture.page, commits: [...fixture.commits, extra] },
      { limit: 100, order: "topological", roots: fixture.roots },
    );
    const record = (await readHistoryCacheRecords()).find(
      (cache) => cache.key === fixture.key,
    );
    if (record === undefined) throw new Error("Missing fixture");
    await pruneHistoryCache(record, () => false);
    expect(
      await readStoredRepositoryHistoryState(
        fixture.environmentId,
        fixture.repositoryId,
      ),
    ).toMatchObject({
      completion: { commitCount: 2 },
      progress: { committedCommitCount: 2 },
    });
    const added = {
      ...fixture.orphan,
      oid: "f".repeat(40),
      parents: ["a".repeat(40)],
      subject: "New tip",
    };
    const roots = [{ name: "main", oid: added.oid, type: "branch" as const }];
    const gateway = {
      read: vi.fn(async () => encodeRepositoryHistoryPage(fixture.page)),
      synchronize: vi.fn<RepositoryHistoryGateway["synchronize"]>(
        async (request, accept) => {
          const basis = request.basis;
          if (basis?._tag !== "Complete")
            throw new Error("Expected a completed basis");
          await accept(
            encodeRepositoryHistoryBatch({
              commits: [added],
              objectFormat: "sha1",
              repositoryId: fixture.repositoryId,
              requestId: crypto.randomUUID(),
              sequence: 0,
              snapshot: {
                id: "f".repeat(64),
                objectFormat: "sha1",
                rootOids: [added.oid],
                refTargets: roots,
                resumable: true,
              },
            }),
          );
          return basis.commitCount + 1;
        },
      ),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway,
    });
    try {
      await reader.read({
        limit: 100,
        order: "chronological",
        roots: fixture.roots,
      });
      await vi.waitFor(() =>
        expect(reader.getSnapshot()).toMatchObject({
          synchronization: "complete",
          synchronizedCommitCount: 3,
        }),
      );
      expect(gateway.synchronize.mock.calls[0]?.[0].basis).toMatchObject({
        _tag: "Complete",
        commitCount: 2,
      });
      expect(gateway.read).not.toHaveBeenCalled();
      expect(
        await reader.read({ limit: 100, order: "chronological", roots }),
      ).toHaveLength(3);
      expect(
        (await reader.getCacheDiagnostics()).caches.find(
          (cache) => cache.repositoryId === fixture.repositoryId,
        )?.commitCount,
      ).toBe(3);
    } finally {
      reader.close();
    }
  });

  it("recognizes incompatible repository records without damaging a compatible cache", async () => {
    const first = await seed();
    const second = await seed();
    await withRepositoryHistoryDatabase(indexedDB, async (database) => {
      const transaction = database.transaction(
        repositoryStoreName,
        "readwrite",
      );
      const completed = transactionCompleted(transaction);
      const store = transaction.objectStore(repositoryStoreName);
      const record = await requestResult<StoredRepository>(
        store.get(first.key),
      );
      store.put({ ...record, cacheFormatVersion: 99 });
      await completed;
    });
    expect(
      await markHistoryCacheOpened(first.environmentId, first.repositoryId),
    ).toBe(false);
    expect(
      await markHistoryCacheOpened(second.environmentId, second.repositoryId),
    ).toBe(true);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: first.environmentId,
      repositoryId: first.repositoryId,
      gateway: gatewayFor(first),
    });
    await expect(reader.getRefTargets()).resolves.toEqual([]);
    expect(reader.getSnapshot().historyRevision).toBeGreaterThan(0);
    await expect(
      reader.getCommitSummaries([first.orphan.oid]),
    ).resolves.toEqual([]);
    expect(
      await markHistoryCacheOpened(first.environmentId, first.repositoryId),
    ).toBe(true);
    expect(
      await readRepositoryCommits(second.environmentId, second.repositoryId, [
        second.orphan.oid,
      ]),
    ).toEqual([second.orphan]);
    reader.close();
  });
});

async function seed(repositoryId = crypto.randomUUID()) {
  const environmentId = crypto.randomUUID();
  const identity = {
    email: "alex@example.test",
    name: "Alex",
    timestampSeconds: 1,
    timezoneOffsetMinutes: 0,
  };
  const commits: RepositoryCommit[] = [
    {
      author: identity,
      committer: identity,
      oid: "a".repeat(40),
      parents: ["b".repeat(40)],
      subject: "Head",
    },
    {
      author: identity,
      committer: identity,
      oid: "b".repeat(40),
      parents: [],
      subject: "Root",
    },
    {
      author: identity,
      committer: identity,
      oid: "c".repeat(40),
      parents: [],
      subject: "Unreachable",
    },
  ];
  const orphan = commits[2];
  if (orphan === undefined) throw new Error("Missing orphan");
  const roots = [
    { name: "main", oid: "a".repeat(40), type: "branch" as const },
  ];
  const page: RepositoryHistoryPage = {
    commits,
    objectFormat: "sha1",
    refTargets: roots,
    repositoryId,
    requestId: crypto.randomUUID(),
  };
  await storeRepositoryHistoryPage(environmentId, repositoryId, page, {
    limit: 100,
    order: "topological",
    roots,
  });
  await storeRepositoryHistoryBatch(environmentId, repositoryId, {
    commits,
    objectFormat: "sha1",
    repositoryId,
    requestId: crypto.randomUUID(),
    sequence: 0,
    snapshot: {
      id: "d".repeat(64),
      objectFormat: "sha1",
      refTargets: roots,
      resumable: true,
      rootOids: roots.map((root) => root.oid),
    },
  });
  await completeStoredRepositoryHistory(
    environmentId,
    repositoryId,
    commits.length,
  );
  return {
    environmentId,
    repositoryId,
    commits,
    orphan,
    key: repositoryKey(environmentId, repositoryId),
    roots,
    page,
  };
}

function gatewayFor(fixture: Awaited<ReturnType<typeof seed>>) {
  return {
    read: vi.fn(async () => encodeRepositoryHistoryPage(fixture.page)),
    synchronize: vi.fn(
      async (
        request: Parameters<RepositoryHistoryGateway["synchronize"]>[0],
        accept: (bytes: Uint8Array) => Promise<void>,
      ) => {
        await accept(
          encodeRepositoryHistoryBatch({
            commits: request.basis?._tag === "Complete" ? [] : fixture.commits,
            objectFormat: "sha1",
            repositoryId: fixture.repositoryId,
            requestId: crypto.randomUUID(),
            sequence: 0,
            snapshot: {
              id: "e".repeat(64),
              objectFormat: "sha1",
              refTargets: fixture.roots,
              resumable: true,
              rootOids: fixture.roots.map((root) => root.oid),
            },
          }),
        );
        return fixture.commits.length;
      },
    ),
  };
}
