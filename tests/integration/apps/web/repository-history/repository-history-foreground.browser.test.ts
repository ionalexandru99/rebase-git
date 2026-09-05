import type { RepositoryCommit } from "@rebase/contracts";
import { expect, it } from "vitest";
import { readRepositoryHistory } from "#web/features/repository-history/repository-history-query";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

it("reads foreground continuation windows before full synchronization while retaining the first page", async () => {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
  const query = {
    roots,
    order: "topological" as const,
    ancestry: "first-parent" as const,
    limit: 100,
  };
  for (const offset of [0, 100]) {
    await storeRepositoryHistoryPage(
      environmentId,
      repositoryId,
      {
        commits: Array.from({ length: 100 }, (_, index) =>
          commit(offset + index),
        ),
        objectFormat: "sha1",
        refTargets: roots,
        repositoryId,
        requestId: crypto.randomUUID(),
      },
      { ...query, offset },
    );
  }
  for (const offset of [100, 0]) {
    const page = await readRepositoryHistory(environmentId, repositoryId, {
      ...query,
      offset,
    });
    expect(page?.map(({ oid }) => oid)).toEqual(
      Array.from({ length: 100 }, (_, index) => oid(offset + index)),
    );
  }
  expect(
    await readRepositoryHistory(environmentId, repositoryId, {
      ...query,
      offset: 200,
    }),
  ).toBeUndefined();
});

it("does not treat a filtered short prefix as the end of an incomplete history", async () => {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
  const query = { roots, order: "topological" as const, limit: 100 };
  const first = { ...commit(0), parents: [oid(500), oid(1)] };
  await storeRepositoryHistoryPage(
    environmentId,
    repositoryId,
    {
      commits: [
        first,
        ...Array.from({ length: 99 }, (_, index) => commit(index + 1)),
      ],
      objectFormat: "sha1",
      refTargets: roots,
      repositoryId,
      requestId: crypto.randomUUID(),
    },
    query,
  );
  expect(
    await readRepositoryHistory(environmentId, repositoryId, {
      ...query,
      ancestry: "first-parent",
    }),
  ).toBeUndefined();
});

function oid(index: number) {
  return index.toString(16).padStart(40, "0");
}

it("replaces an exhausted foreground continuation when synchronization supplies deeper history", async () => {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const roots = [{ name: "main", oid: oid(0), type: "branch" as const }];
  const query = { roots, order: "topological" as const, limit: 100 };
  for (const offset of [0, 100]) {
    await storeRepositoryHistoryPage(
      environmentId,
      repositoryId,
      {
        commits:
          offset === 0
            ? Array.from({ length: 100 }, (_, index) => commit(index))
            : [],
        objectFormat: "sha1",
        refTargets: roots,
        repositoryId,
        requestId: crypto.randomUUID(),
      },
      { ...query, offset },
    );
  }
  expect(
    await readRepositoryHistory(environmentId, repositoryId, {
      ...query,
      offset: 100,
    }),
  ).toEqual([]);
  await beginRepositoryHistorySynchronization(environmentId, repositoryId);
  await storeRepositoryHistoryBatch(environmentId, repositoryId, {
    commits: Array.from({ length: 201 }, (_, index) =>
      index === 200 ? { ...commit(index), parents: [] } : commit(index),
    ),
    objectFormat: "sha1",
    repositoryId,
    requestId: crypto.randomUUID(),
    sequence: 0,
  });
  await completeStoredRepositoryHistory(environmentId, repositoryId, 201);
  expect(
    (
      await readRepositoryHistory(environmentId, repositoryId, {
        ...query,
        offset: 100,
      })
    )?.map(({ oid }) => oid),
  ).toEqual(Array.from({ length: 100 }, (_, index) => oid(index + 100)));
});

function commit(index: number): RepositoryCommit {
  const identity = {
    name: "Graph",
    email: "graph@example.test",
    timestampSeconds: 1_000 - index,
    timezoneOffsetMinutes: 0,
  };
  return {
    oid: oid(index),
    parents: [oid(index + 1)],
    subject: `Commit ${index}`,
    author: identity,
    committer: identity,
  };
}
