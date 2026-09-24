import {
  encodeRepositoryHistoryBatch,
  encodeRepositoryHistoryPage,
  type RepositoryCommit,
  type RepositoryHistoryPage,
} from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  acquireSharedWorker,
  createBrowserRepositoryHistoryReader,
} from "#web/features/repository-history/browser-repository-history-reader";
import {
  clearHistoryCache,
  describeHistoryCaches,
  markHistoryCacheOpened,
} from "#web/features/repository-history/cache/repository-history-storage";
import { writeHistoryUnderPressure } from "#web/features/repository-history/cache/repository-history-storage-maintenance";
import { readRepositoryCommits } from "#web/features/repository-history/query/repository-history-query";
import {
  completeStoredRepositoryHistory,
  readStoredRepositoryHistoryState,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/replica/repository-history-store";
import {
  type RepositoryHistoryGateway,
  RepositoryHistoryOffline,
  RepositoryHistoryStorageUnavailable,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";
import { manageBrowserHistoryStorage } from "#web/features/repository-history/storage/browser-history-storage";
import { readHistoryCacheRecords } from "#web/persistence/repository-history/repository-history-cache-records";
import { repositoryKey } from "#web/persistence/repository-history/repository-history-records";

describe("history cache storage", () => {
  it("releases the shared worker error listener after inspecting storage", async () => {
    const worker = acquireSharedWorker();
    const added = vi.spyOn(worker, "addEventListener");
    const removed = vi.spyOn(worker, "removeEventListener");
    try {
      await Effect.runPromise(manageBrowserHistoryStorage("inspect"));
      const listener = added.mock.calls.find(([type]) => type === "error")?.[1];
      expect(listener).toBeDefined();
      expect(removed).toHaveBeenCalledWith("error", listener);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });

  it("rebuilds history from settings before a graph has requested a page", async () => {
    const fixture = await seed();
    const gateway = gatewayFor(fixture);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway,
    });
    try {
      await reader.getCacheDiagnostics();
      expect(gateway.read).not.toHaveBeenCalled();
      await reader.manageCache("rebuild");
      await vi.waitFor(() =>
        expect(reader.getSnapshot().synchronization).toBe("complete"),
      );
      expect(gateway.synchronize).toHaveBeenCalledOnce();
      expect(gateway.read).not.toHaveBeenCalled();
      expect(
        (await reader.getCacheDiagnostics()).caches.find(
          ({ repositoryId }) => repositoryId === fixture.repositoryId,
        )?.commitCount,
      ).toBe(fixture.commits.length);
    } finally {
      reader.close();
    }
  });

  it("inspects caches without an open repository and clears open readers through application settings", async () => {
    const fixture = await seed();
    const diagnostics = await Effect.runPromise(
      manageBrowserHistoryStorage("inspect"),
    );
    expect(
      diagnostics.caches.some(
        ({ repositoryId }) => repositoryId === fixture.repositoryId,
      ),
    ).toBe(true);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: fixture.environmentId,
      repositoryId: fixture.repositoryId,
      gateway: gatewayFor(fixture),
    });
    try {
      await reader.getRefTargets();
      await Effect.runPromise(manageBrowserHistoryStorage("clear"));
      expect(
        await reader.getCommitSummaries(fixture.commits.map(({ oid }) => oid)),
      ).toEqual([]);
      expect(
        await reader.read({
          roots: fixture.roots,
          order: "topological",
          limit: 10,
        }),
      ).toEqual([]);
    } finally {
      reader.close();
    }
  });

  it("does not restart history on a reader closed while rebuilding its shared cache", async () => {
    const fixture = await seed();
    const name = crypto.randomUUID();
    const control = new BroadcastChannel(`history-clear-${name}`);
    const waiting = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    control.onmessage = (message) => {
      if (message.data === "waiting") waiting.resolve();
      if (message.data === "closed") closed.resolve();
    };
    const worker = new SharedWorker(
      new URL("./fixtures/history-cache-clear-worker.ts", import.meta.url),
      { type: "module", name },
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
    const query = {
      limit: 100,
      order: "topological" as const,
      roots: fixture.roots,
    };
    try {
      await first.read(query);
      await vi.waitFor(() =>
        expect(first.getSnapshot().synchronization).toBe("complete"),
      );
      await second.getRefTargets();
      const statuses: string[] = [];
      second.subscribe(() => statuses.push(second.getSnapshot().status));
      const rebuilding = expect(
        first.manageCache("rebuild"),
      ).rejects.toBeInstanceOf(RepositoryHistoryUnavailable);
      await waiting.promise;
      first.close();
      await closed.promise;
      control.postMessage("continue");
      await rebuilding;
      await second.manageCache("clear");
      expect(statuses).not.toContain("loading");
      expect(second.getSnapshot().status).toBe("empty");
      expect(gateway.read).not.toHaveBeenCalled();
      await second.manageCache("rebuild");
      await expect(second.read(query)).resolves.toEqual(fixture.page.commits);
    } finally {
      first.close();
      second.close();
      control.close();
      worker.port.close();
    }
  });

  it.each([false, true])(
    "initializes a repository opened during clear-all after it settles (failure=%s)",
    async (fail) => {
      const firstFixture = await seed();
      const secondFixture = await seed();
      const name = crypto.randomUUID();
      const control = new BroadcastChannel(`history-clear-${name}`);
      const waiting = Promise.withResolvers<void>();
      const connecting = Promise.withResolvers<void>();
      control.onmessage = (message) => {
        if (message.data === "waiting") waiting.resolve();
        if (message.data === "connecting") connecting.resolve();
      };
      const worker = new SharedWorker(
        new URL("./fixtures/history-cache-clear-worker.ts", import.meta.url),
        { type: "module", name },
      );
      const first = createBrowserRepositoryHistoryReader({
        environmentId: firstFixture.environmentId,
        repositoryId: firstFixture.repositoryId,
        gateway: gatewayFor(firstFixture),
        worker,
      });
      await first.getRefTargets();
      const clearing = first.manageCache("clear-all");
      const outcome = fail
        ? expect(clearing).rejects.toBeInstanceOf(
            RepositoryHistoryStorageUnavailable,
          )
        : expect(clearing).resolves.toBeUndefined();
      await waiting.promise;
      const gateway = gatewayFor(secondFixture);
      const second = createBrowserRepositoryHistoryReader({
        environmentId: secondFixture.environmentId,
        repositoryId: secondFixture.repositoryId,
        gateway,
        worker,
      });
      const refs = second.getRefTargets();
      await connecting.promise;
      control.postMessage(fail ? "fail" : "continue");
      try {
        await outcome;
        await expect(refs).resolves.toEqual(fail ? secondFixture.roots : []);
        await expect(
          second.read({
            limit: 100,
            order: "topological",
            roots: secondFixture.roots,
          }),
        ).resolves.toEqual(fail ? secondFixture.page.commits : []);
        expect(gateway.read).not.toHaveBeenCalled();
        if (!fail)
          expect(second.getSnapshot()).toMatchObject({
            status: "empty",
            synchronizedCommitCount: 0,
            synchronization: "idle",
          });
      } finally {
        first.close();
        second.close();
        control.close();
        worker.port.close();
      }
    },
  );

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
      await expect(first.read(query)).resolves.toEqual(fixture.page.commits);
      await expect(second.read(query)).resolves.toEqual(fixture.page.commits);
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
        RepositoryHistoryOffline,
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
    const reopened = createBrowserRepositoryHistoryReader(options);
    try {
      await expect(
        reopened.read({
          limit: 100,
          order: "topological",
          roots: fixture.roots,
        }),
      ).resolves.toEqual(fixture.page.commits);
      expect(options.gateway.read).toHaveBeenCalledOnce();
    } finally {
      reopened.close();
    }
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

  it("shows a server page that storage could not cache", async () => {
    const repositoryId = crypto.randomUUID();
    const fixture = await seed(repositoryId);
    const worker = new SharedWorker(
      new URL("./fixtures/history-storage-full-worker.ts", import.meta.url),
      { type: "module", name: crypto.randomUUID() },
    );
    const gateway = gatewayFor(fixture);
    const reader = createBrowserRepositoryHistoryReader({
      environmentId: crypto.randomUUID(),
      repositoryId,
      gateway,
      worker,
    });
    try {
      await expect(
        reader.read({ limit: 100, order: "topological", roots: fixture.roots }),
      ).resolves.toEqual(fixture.page.commits);
      expect(gateway.read).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(reader.getSnapshot()).toMatchObject({
          status: "ready",
          error: expect.any(RepositoryHistoryStorageUnavailable),
        }),
      );
    } finally {
      reader.close();
      worker.port.close();
    }
  });

  it("evicts the oldest complete closed cache until the write fits", async () => {
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
    expect(writes).toBe(2);
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
  it("describes stored commits from the repository counter and retains identity when cleared", async () => {
    const fixture = await seed();
    await markHistoryCacheOpened(fixture.environmentId, fixture.repositoryId);
    const diagnostics = describeHistoryCaches(
      await readHistoryCacheRecords(),
      (key) => key === fixture.key,
      1_000_000,
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
    commits: commits.slice(0, 2),
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
