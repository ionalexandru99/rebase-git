import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import {
  completeStoredRepositoryHistory,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/replica/repository-history-store";
import { RepositoryHistoryOffline } from "#web/features/repository-history/repository-history-reader.contract";
import { searchStoredRepositoryHistory } from "#web/features/repository-history/search/repository-history-search";
import { createRepositoryHistorySearchModel } from "#web/features/repository-history/search/repository-history-search-model";
import {
  emptyStoredRepository,
  storedCommit,
} from "#web/persistence/repository-history/repository-history-records";

describe("browser metadata search", () => {
  it("runs the search model through the worker and cached storage without network access", async () => {
    const fixture = await seed(30);
    const gateway = offlineGateway();
    const reader = createBrowserRepositoryHistoryReader({
      ...fixture,
      gateway,
    });
    const navigate = vi.fn(async () => {});
    const model = createRepositoryHistorySearchModel(reader, navigate);
    try {
      model.setText("Commit");
      await vi.waitFor(() =>
        expect(model.getSnapshot()).toMatchObject({
          loading: false,
          count: 30,
          complete: true,
        }),
      );
      expect(model.getSnapshot().commits).toHaveLength(20);
      model.navigate(20);
      await vi.waitFor(() =>
        expect(model.getSnapshot()).toMatchObject({
          loading: false,
          navigating: false,
          selected: 20,
        }),
      );
      expect(model.getSnapshot().commits).toHaveLength(30);
      expect(navigate).toHaveBeenCalledWith(
        fixture.commits[20]?.oid,
        expect.any(AbortSignal),
      );
      expect(gateway.read).not.toHaveBeenCalled();
      expect(gateway.synchronize).not.toHaveBeenCalled();
    } finally {
      await model.dispose();
      reader.close();
    }
  });

  it("stops before another bulk chunk when cancellation arrives during a read", async () => {
    const fixture = await seed(500);
    const controller = new AbortController();
    const prototype = IDBObjectStore.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "getAll");
    const original = descriptor?.value;
    if (typeof original !== "function")
      throw new Error("Bulk reads are unavailable");
    let reads = 0;
    Object.defineProperty(prototype, "getAll", {
      configurable: true,
      value: function (this: IDBObjectStore, ...args: readonly unknown[]) {
        reads += 1;
        const request = Reflect.apply(
          original,
          this,
          args,
        ) as IDBRequest<unknown>;
        request.addEventListener("success", () => controller.abort(), {
          once: true,
        });
        return request;
      },
    });
    try {
      await expect(
        searchStoredRepositoryHistory(
          fixture.environmentId,
          fixture.repositoryId,
          { text: "absent", limit: 100 },
          controller.signal,
        ),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(reads).toBe(1);
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(prototype, "getAll", descriptor);
    }
  });

  it("searches already cached version-three commits after the compatible upgrade", async () => {
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const databaseName = `history-search-upgrade-${crypto.randomUUID()}`;
    const isolatedIndexedDB: IDBFactory = {
      open: (_name, version) => indexedDB.open(databaseName, version),
      deleteDatabase: () => indexedDB.deleteDatabase(databaseName),
      databases: () => indexedDB.databases(),
      cmp: (first, second) => indexedDB.cmp(first, second),
    };
    const identity = {
      name: "Alex",
      email: "alex@example.test",
      timestampSeconds: 1,
      timezoneOffsetMinutes: 0,
    };
    const commit: RepositoryCommit = {
      oid: "a".repeat(40),
      parents: [],
      author: identity,
      committer: identity,
      subject: "Before upgrade",
    };
    await createVersionThreeCache(
      environmentId,
      repositoryId,
      commit,
      isolatedIndexedDB,
    );
    const result = await searchStoredRepositoryHistory(
      environmentId,
      repositoryId,
      { text: "upgrade", limit: 100 },
      undefined,
      isolatedIndexedDB,
    );
    expect(result.commits).toEqual([commit]);
  });

  it("searches incomplete cached metadata offline without starting a network request", async () => {
    const fixture = await seed(3, false);
    const gateway = offlineGateway();
    const reader = createBrowserRepositoryHistoryReader({
      ...fixture,
      logicalRepositoryId: fixture.repositoryId,
      repositoryId: crypto.randomUUID(),
      gateway,
    });
    const result = await reader.search({ text: "main", limit: 100 });
    expect(result).toMatchObject({
      commits: [fixture.commits[0]],
      replicaComplete: false,
      synchronizedCommitCount: 0,
    });
    expect(gateway.read).not.toHaveBeenCalled();
    expect(gateway.synchronize).not.toHaveBeenCalled();
    reader.close();
  });

  it("returns stable ascending OID pages independently of commit dates", async () => {
    const fixture = await seed(4);
    const reader = createBrowserRepositoryHistoryReader({
      ...fixture,
      gateway: offlineGateway(),
    });
    const first = await reader.search({ text: "Commit", limit: 2 });
    const second = await reader.search({
      text: "Commit",
      limit: 2,
      cursor: continuation(first),
    });
    const last = await reader.search({
      text: "Commit",
      limit: 2,
      cursor: continuation(second),
    });
    expect(
      [...first.commits, ...second.commits].map((commit) => commit.oid),
    ).toEqual([
      fixture.commits[0]?.oid,
      fixture.commits[1]?.oid,
      fixture.commits[2]?.oid,
      fixture.commits[3]?.oid,
    ]);
    expect(first.replicaComplete).toBe(true);
    expect(first.synchronizedCommitCount).toBe(4);
    expect(last).toMatchObject({ commits: [] });
    expect(last.nextCursor).toBeUndefined();
    reader.close();
  });

  it("bounds sparse scans and resumes beyond the first 4096 commits", async () => {
    const fixture = await seed(5_000);
    const first = await searchStoredRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { text: "Commit 4999", limit: 100 },
    );
    expect(first.commits).toEqual([]);
    expect(first.nextCursor).toBeDefined();
    const second = await searchStoredRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { text: "Commit 4999", limit: 100, cursor: continuation(first) },
    );
    expect(second.commits).toEqual([fixture.commits[4_999]]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("supersedes search independently from commit reads and sibling readers", async () => {
    const fixture = await seed(500);
    const options = { ...fixture, gateway: offlineGateway() };
    const reader = createBrowserRepositoryHistoryReader(options);
    const sibling = createBrowserRepositoryHistoryReader(options);
    const previous = reader.search({ text: "absent", limit: 100 });
    const canceled = expect(previous).rejects.toMatchObject({
      name: "AbortError",
    });
    const current = reader.search({ text: "Commit 499", limit: 100 });
    const [result, siblingResult, summaries] = await Promise.all([
      current,
      sibling.search({ text: "main", limit: 100 }),
      reader.getCommitSummaries([fixture.commits[0]?.oid ?? ""]),
      canceled,
    ]);
    expect(result.commits).toEqual([fixture.commits[499]]);
    expect(siblingResult.commits).toEqual([fixture.commits[0]]);
    expect(summaries).toEqual([fixture.commits[0]]);
    reader.close();
    sibling.close();
  });

  it("aborts caller-canceled searches without changing repository status", async () => {
    const fixture = await seed(500);
    const reader = createBrowserRepositoryHistoryReader({
      ...fixture,
      gateway: offlineGateway(),
    });
    await reader.getRefTargets();
    const previous = reader.getSnapshot();
    const controller = new AbortController();
    const pending = reader.search(
      { text: "absent", limit: 100 },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(reader.getSnapshot()).toEqual(previous);
    reader.close();
    await expect(
      reader.search({ text: "Commit", limit: 100 }),
    ).rejects.toBeInstanceOf(RepositoryHistoryOffline);
  });

  it("rejects cross-repository continuations without leaking results", async () => {
    const first = await seed(4);
    const second = await seed(4);
    const result = await searchStoredRepositoryHistory(
      first.environmentId,
      first.repositoryId,
      { text: "Commit", limit: 1 },
    );
    await expect(
      searchStoredRepositoryHistory(second.environmentId, second.repositoryId, {
        text: "Commit",
        limit: 1,
        cursor: continuation(result),
      }),
    ).rejects.toThrow("does not match");
  });

  it.each([
    { text: "Commit", limit: 101 },
    { text: "Commit", limit: 0 },
    { text: "a".repeat(257), limit: 100 },
  ])("rejects queries beyond the work bounds", async (query) => {
    await expect(
      searchStoredRepositoryHistory(
        crypto.randomUUID(),
        crypto.randomUUID(),
        query,
      ),
    ).rejects.toThrow("exceeds its limits");
  });
});

function continuation(result: { readonly nextCursor?: string }) {
  if (result.nextCursor === undefined)
    throw new Error("Expected another search page");
  return result.nextCursor;
}

function offlineGateway() {
  return {
    read: vi.fn(async () => {
      throw new RepositoryHistoryOffline();
    }),
    synchronize: vi.fn(async () => {
      throw new RepositoryHistoryOffline();
    }),
  };
}

async function seed(count: number, complete = true) {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const commits: RepositoryCommit[] = Array.from(
    { length: count },
    (_, index) => {
      const identity = {
        name: "Alex",
        email: "alex@example.test",
        timestampSeconds: 1_777_777_777 - Math.floor(index / 2),
        timezoneOffsetMinutes: 0,
      };
      return {
        author: identity,
        committer: identity,
        oid: index.toString(16).padStart(40, "0"),
        parents: [],
        subject: `Commit ${index}`,
      };
    },
  );
  const roots = [
    { name: "main", type: "branch" as const, oid: commits[0]?.oid ?? "" },
  ];
  await storeRepositoryHistoryPage(
    environmentId,
    repositoryId,
    {
      commits: commits.slice(0, 100),
      refTargets: roots,
      objectFormat: "sha1",
      repositoryId,
      requestId: crypto.randomUUID(),
    },
    { roots, order: "topological", limit: 100 },
  );
  if (complete) {
    for (let offset = 0; offset < count; offset += 500) {
      await storeRepositoryHistoryBatch(environmentId, repositoryId, {
        commits: commits.slice(offset, offset + 500),
        objectFormat: "sha1",
        repositoryId,
        requestId: crypto.randomUUID(),
        sequence: offset / 500,
      });
    }
    await completeStoredRepositoryHistory(environmentId, repositoryId, count);
  }
  return { environmentId, repositoryId, commits };
}

function createVersionThreeCache(
  environmentId: string,
  repositoryId: string,
  commit: RepositoryCommit,
  factory: IDBFactory,
) {
  return new Promise<void>((resolve, reject) => {
    const request = factory.open("rebase-repository-history", 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      const commits = database.createObjectStore("commits", { keyPath: "key" });
      commits.createIndex("repositoryOrder", [
        "environmentId",
        "repositoryId",
        "topologicalEpoch",
        "topologicalOrder",
      ]);
      database.createObjectStore("repositories", { keyPath: "key" });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        ["commits", "repositories"],
        "readwrite",
      );
      transaction
        .objectStore("commits")
        .put(storedCommit(environmentId, repositoryId, commit));
      transaction
        .objectStore("repositories")
        .put(emptyStoredRepository(environmentId, repositoryId, "sha1"));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}
