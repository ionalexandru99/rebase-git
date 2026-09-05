import {
  encodeRepositoryHistoryBatch,
  type RepositoryCommit,
  type RepositoryHistoryBatch,
} from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import { readRepositoryCommits } from "#web/features/repository-history/repository-history-query";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import {
  beginRepositoryHistorySynchronization,
  completeStoredRepositoryHistory,
  readStoredRepositoryHistoryState,
  restartRepositoryHistorySynchronization,
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/repository-history-store";

describe("durable history counts", () => {
  it("counts stored OIDs after resetting and restoring a tip without changing resume offsets", async () => {
    const fixture = await seed();
    const { environmentId, repositoryId, commits, batch } = fixture;
    const [tip, parent, root] = commits;
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({
      _tag: "Complete",
      commitCount: 3,
      rootOids: [tip.oid],
    });
    await storeRepositoryHistoryBatch(
      environmentId,
      repositoryId,
      batch([], parent, false),
    );
    await completeStoredRepositoryHistory(environmentId, repositoryId, 3);
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({
      _tag: "Complete",
      commitCount: 3,
      rootOids: [parent.oid],
    });
    const restored = batch([tip], tip, false);
    await storeRepositoryHistoryBatch(environmentId, repositoryId, restored);
    await storeRepositoryHistoryBatch(environmentId, repositoryId, restored);
    expect(
      await readStoredRepositoryHistoryState(environmentId, repositoryId),
    ).toMatchObject({
      progress: { committedCommitCount: 4, nextBatchSequence: 1 },
    });
    expect(
      await readRepositoryCommits(
        environmentId,
        repositoryId,
        commits.map((commit) => commit.oid),
      ),
    ).toHaveLength(3);
    expect(
      await completeStoredRepositoryHistory(environmentId, repositoryId, 4),
    ).toMatchObject({ commitCount: 3 });
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({
      _tag: "Complete",
      commitCount: 3,
    });

    await restartRepositoryHistorySynchronization(environmentId, repositoryId);
    await storeRepositoryHistoryBatch(
      environmentId,
      repositoryId,
      batch([tip, parent], tip, true),
    );
    expect(
      await beginRepositoryHistorySynchronization(environmentId, repositoryId),
    ).toMatchObject({
      _tag: "Incomplete",
      committedCommitCount: 2,
      nextBatchSequence: 1,
    });
    const { snapshot: _, ...continuation } = batch([root], tip, true);
    await storeRepositoryHistoryBatch(environmentId, repositoryId, {
      ...continuation,
      sequence: 1,
    });
    expect(
      await completeStoredRepositoryHistory(environmentId, repositoryId, 3),
    ).toMatchObject({ commitCount: 3 });
  });

  it("publishes the distinct durable count after receiving an already cached commit", async () => {
    const { environmentId, repositoryId, commits, batch } = await seed();
    const tip = commits[0];
    const gateway: RepositoryHistoryGateway = {
      read: vi.fn(async () => {
        throw new Error("History is already cached");
      }),
      synchronize: vi.fn(async (request, accept) => {
        expect(request.basis).toMatchObject({
          _tag: "Complete",
          commitCount: 3,
        });
        await accept(encodeRepositoryHistoryBatch(batch([tip], tip, false)));
        return 4;
      }),
    };
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      repositoryId,
      gateway,
    });
    try {
      await reader.read({
        limit: 100,
        order: "topological",
        roots: [{ name: "main", type: "branch", oid: tip.oid }],
      });
      await vi.waitFor(() =>
        expect(gateway.synchronize).toHaveBeenCalledOnce(),
      );
      await vi.waitFor(() =>
        expect(reader.getSnapshot()).toMatchObject({
          synchronization: "complete",
          synchronizedCommitCount: 3,
        }),
      );
    } finally {
      reader.close();
    }
  });
});

async function seed() {
  const environmentId = crypto.randomUUID();
  const repositoryId = crypto.randomUUID();
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    timestampSeconds: 1,
    timezoneOffsetMinutes: 0,
  };
  const root: RepositoryCommit = {
    oid: "a".repeat(40),
    parents: [],
    author: identity,
    committer: identity,
    subject: "Root",
  };
  const parent: RepositoryCommit = {
    ...root,
    oid: "b".repeat(40),
    parents: [root.oid],
    subject: "Parent",
  };
  const tip: RepositoryCommit = {
    ...root,
    oid: "c".repeat(40),
    parents: [parent.oid],
    subject: "Tip",
  };
  const commits = [tip, parent, root] as const;
  const ref = (commit: RepositoryCommit) => ({
    name: "main",
    type: "branch" as const,
    oid: commit.oid,
  });
  const batch = (
    values: readonly RepositoryCommit[],
    commit: RepositoryCommit,
    resumable: boolean,
  ): RepositoryHistoryBatch => ({
    commits: values,
    objectFormat: "sha1",
    repositoryId,
    requestId: crypto.randomUUID(),
    sequence: 0,
    snapshot: {
      id: commit.oid.padEnd(64, "0"),
      objectFormat: "sha1",
      refTargets: [ref(commit)],
      resumable,
      rootOids: [commit.oid],
    },
  });
  await storeRepositoryHistoryPage(
    environmentId,
    repositoryId,
    {
      commits: [tip, parent],
      objectFormat: "sha1",
      refTargets: [ref(tip)],
      repositoryId,
      requestId: crypto.randomUUID(),
    },
    { limit: 100, order: "topological", roots: [ref(tip)] },
  );
  await beginRepositoryHistorySynchronization(environmentId, repositoryId);
  await storeRepositoryHistoryBatch(
    environmentId,
    repositoryId,
    batch(commits, tip, true),
  );
  expect(
    await completeStoredRepositoryHistory(environmentId, repositoryId, 3),
  ).toMatchObject({ commitCount: 3 });
  return { environmentId, repositoryId, commits, batch };
}
