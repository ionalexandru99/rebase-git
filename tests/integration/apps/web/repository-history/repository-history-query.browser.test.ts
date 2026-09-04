import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import type { HistoryOrderCache } from "#web/features/repository-history/history-order.contract";
import {
  locateRepositoryHistoryCommits,
  prepareRepositoryHistoryOrder,
  readRepositoryHistory,
} from "#web/features/repository-history/repository-history-query";
import {
  completeStoredRepositoryHistory,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

describe("local ordered history pages", () => {
  it("keeps absolute positions after reading a nonzero page from incomplete history", async () => {
    const source = await seed("main", false);
    const environmentId = crypto.randomUUID();
    const repositoryId = crypto.randomUUID();
    const commits = ["merge", "right", "left", "base"].flatMap((subject) =>
      source.commits.filter((commit) => commit.subject === subject),
    );
    await initialPage(environmentId, repositoryId, "main", commits);
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    const query = {
      roots: [root("main", "merge")],
      order: "chronological" as const,
      offset: 2,
      limit: 1,
    };
    expect(
      (
        await readRepositoryHistory(
          environmentId,
          repositoryId,
          query,
          indexedDB,
          cache,
        )
      )?.map(({ subject }) => subject),
    ).toEqual(["left"]);
    expect(
      await locateRepositoryHistoryCommits(
        environmentId,
        repositoryId,
        query,
        [oid("merge"), oid("left")],
        cache,
      ),
    ).toEqual([
      { oid: oid("merge"), index: 0 },
      { oid: oid("left"), index: 2 },
    ]);
  });

  it("locates a batch without reading commit metadata once the ordered scope is cached", async () => {
    const fixture = await seed("main", false);
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    const query = {
      roots: [root("main", "merge")],
      ancestry: "first-parent" as const,
      order: "topological" as const,
      limit: 100,
    };
    await locateRepositoryHistoryCommits(
      fixture.environmentId,
      fixture.repositoryId,
      query,
      [oid("merge")],
      cache,
    );
    const transactions = vi.spyOn(IDBDatabase.prototype, "transaction");
    try {
      expect(
        await locateRepositoryHistoryCommits(
          fixture.environmentId,
          fixture.repositoryId,
          { ...query, additionalParentEdges: [] },
          [oid("base"), oid("left"), oid("right"), oid("left")],
          cache,
        ),
      ).toEqual([
        { oid: oid("left"), index: 1 },
        { oid: oid("base"), index: 2 },
      ]);
      expect(transactions).not.toHaveBeenCalled();
    } finally {
      transactions.mockRestore();
    }
  });

  it("shares one cold index scan across concurrent readers and retries after a scan failure", async () => {
    const fixture = await seed("main", false);
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    const reads = vi.spyOn(IDBIndex.prototype, "getAll");
    const prepare = () =>
      prepareRepositoryHistoryOrder(
        fixture.environmentId,
        fixture.repositoryId,
        cache,
      );
    try {
      reads.mockImplementationOnce(() => {
        throw new DOMException("Index unavailable", "InvalidStateError");
      });
      await expect(prepare()).rejects.toThrow();
      reads.mockClear();
      await Promise.all([prepare(), prepare(), prepare()]);
      expect(reads).toHaveBeenCalledTimes(1);
      expect(cache.index?.order([oid("merge")], "topological")).toHaveLength(4);
      await prepare();
      expect(reads).toHaveBeenCalledTimes(1);
    } finally {
      reads.mockRestore();
    }
  });

  it("restarts index preparation when the stored generation changes", async () => {
    const fixture = await seed("main", false);
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    const stale = prepareRepositoryHistoryOrder(
      fixture.environmentId,
      fixture.repositoryId,
      cache,
    );
    cache.revision += 1;
    const current = prepareRepositoryHistoryOrder(
      fixture.environmentId,
      fixture.repositoryId,
      cache,
    );
    expect(current).not.toBe(stale);
    await Promise.all([stale, current]);
    expect(cache.index?.order([oid("merge")], "topological")).toHaveLength(4);
  });

  it("does not inherit the first page ordering of a different ref scope", async () => {
    const fixture = await seed("side", false);
    const result = await readRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { roots: [root("main", "merge")], order: "chronological", limit: 100 },
    );
    expect(result?.map((commit) => commit.subject)).toEqual([
      "merge",
      "right",
      "left",
      "base",
    ]);
  });

  it("preserves a same-ref prefix when its tip moves before the first full local query", async () => {
    const fixture = await seed("main", true);
    const result = await readRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { roots: [root("main", "new")], order: "chronological", limit: 100 },
    );
    expect(result?.map((commit) => commit.subject)).toEqual([
      "new",
      "merge",
      "right",
      "left",
      "base",
    ]);
  });

  it("extends a cached prefix consistently even after another scope replaces the shared initial page", async () => {
    const fixture = await seed("main", true);
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    const query = {
      roots: [root("main", "merge")],
      order: "chronological" as const,
      limit: 2,
    };
    const first = await readRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      query,
      indexedDB,
      cache,
    );
    await initialPage(
      fixture.environmentId,
      fixture.repositoryId,
      "other",
      [fixture.commits[2], fixture.commits[4]].filter(
        (commit): commit is RepositoryCommit => commit !== undefined,
      ),
    );
    const second = await readRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { ...query, offset: 2 },
      indexedDB,
      cache,
    );
    const repeated = await readRepositoryHistory(
      fixture.environmentId,
      fixture.repositoryId,
      { ...query, limit: 4 },
      indexedDB,
      cache,
    );
    expect(first?.map((commit) => commit.subject)).toEqual(["merge", "right"]);
    expect(second?.map((commit) => commit.subject)).toEqual(["left", "base"]);
    expect(repeated?.map((commit) => commit.subject)).toEqual([
      "merge",
      "right",
      "left",
      "base",
    ]);
  });

  it.each([
    { offset: -1, limit: 100 },
    { offset: 0.5, limit: 100 },
    { offset: Number.MAX_SAFE_INTEGER, limit: 100 },
    { offset: 0, limit: 1001 },
    { offset: 0, limit: 0 },
  ])(
    "rejects unbounded or imprecise page ranges",
    async ({ offset, limit }) => {
      await expect(
        readRepositoryHistory("missing", "missing", {
          roots: [],
          order: "topological",
          offset,
          limit,
        }),
      ).rejects.toThrow("supported range");
    },
  );
});

function root(name: string, subject: string) {
  return { name, type: "branch" as const, oid: oid(subject) };
}

function oid(subject: string) {
  const index = ["new", "merge", "left", "right", "base"].indexOf(subject);
  return index.toString(16).padStart(40, "0");
}

async function seed(name: string, ties: boolean) {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const parents = {
    new: ["merge"],
    merge: ["left", "right"],
    left: ["base"],
    right: ["base"],
    base: [],
  };
  const timestamps = {
    new: 20,
    merge: 0,
    left: 1,
    right: ties ? 1 : 10,
    base: 0,
  };
  const commits: RepositoryCommit[] = Object.entries(parents).map(
    ([subject, parents]) => {
      const identity = {
        name: "Alex",
        email: "alex@example.test",
        timestampSeconds: timestamps[subject as keyof typeof timestamps],
        timezoneOffsetMinutes: 0,
      };
      return {
        oid: oid(subject),
        parents: parents.map(oid),
        subject,
        author: identity,
        committer: identity,
      };
    },
  );
  const initialSubjects =
    name === "side" ? ["left", "base"] : ["merge", "right"];
  await initialPage(
    environmentId,
    repositoryId,
    name,
    initialSubjects.flatMap((subject) =>
      commits.filter((commit) => commit.subject === subject),
    ),
  );
  await storeRepositoryHistoryBatch(environmentId, repositoryId, {
    repositoryId,
    requestId: crypto.randomUUID(),
    objectFormat: "sha1",
    sequence: 0,
    commits,
  });
  await completeStoredRepositoryHistory(
    environmentId,
    repositoryId,
    commits.length,
  );
  return { environmentId, repositoryId, commits };
}

async function initialPage(
  environmentId: string,
  repositoryId: string,
  name: string,
  commits: readonly RepositoryCommit[],
) {
  const target = commits[0];
  if (target === undefined) throw new Error("Missing initial root");
  const roots = [root(name, target.subject)];
  await storeRepositoryHistoryPage(
    environmentId,
    repositoryId,
    {
      repositoryId,
      requestId: crypto.randomUUID(),
      objectFormat: "sha1",
      refTargets: roots,
      commits,
    },
    { roots, order: "chronological", limit: commits.length },
  );
}
