import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it } from "vitest";
import type { HistoryOrderCache } from "#web/features/repository-history/history-order.contract";
import { readRepositoryHistory } from "#web/features/repository-history/repository-history-query";
import {
  completeStoredRepositoryHistory,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

describe("local ordered history pages", () => {
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
