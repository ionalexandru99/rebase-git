import { describe, expect, it, onTestFinished } from "vite-plus/test";
import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
  RepositoryHistoryUpdate,
  SynchronizeRepositoryHistory,
} from "#contracts/repository-history/repository-history.contract.ts";
import { historyCommit, historyScope } from "#tests-support/history.ts";
import type { HistorySnapshot } from "#web/features/repository-history/history-worker-protocol.ts";
import { HistoryReplica } from "#web/features/repository-history/worker/history-replica.ts";
import type { EnvironmentSocket } from "#web/platform/environment/environment-connection.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";

describe("history replica in browser storage", () => {
  it("appends an incremental synchronization before the history it extends", async () => {
    const f = fixture();
    const base = [
      historyCommit("c3", ["c2"], 3),
      historyCommit("c2", ["c1"], 2),
      historyCommit("c1", [], 1),
    ];
    await f.synchronize(tips(["c3"]), base);
    await f.synchronize(tips(["c5"]), [
      historyCommit("c5", ["c4"], 5),
      historyCommit("c4", ["c3"], 4),
    ]);

    expect(f.requests.at(-1)).toEqual({
      repositoryId,
      knownTips: ["c3"],
      shallowOids: [],
    });
    expect(await f.oids(["c5"])).toEqual(["c5", "c4", "c3", "c2", "c1"]);
    expect(f.snapshot()).toMatchObject({
      status: "ready",
      synchronization: "complete",
      commitCount: 5,
    });
  });

  it("follows a force push and keeps replaced commits out of the new scope", async () => {
    const f = fixture();
    await f.synchronize(tips(["c3"]), [
      historyCommit("c3", ["c2"], 3),
      historyCommit("c2", ["c1"], 2),
      historyCommit("c1", [], 1),
    ]);
    await f.synchronize(tips(["rewritten"]), [
      historyCommit("rewritten", ["c1"], 4),
    ]);

    expect(await f.oids(["rewritten"])).toEqual(["rewritten", "c1"]);
    expect(f.requests.at(-1)?.knownTips).toEqual(["c3"]);
  });

  it("reopens, searches and switches scopes without a server", async () => {
    const first = fixture();
    await first.synchronize(tips(["main", "topic"]), [
      historyCommit("topic", ["base"], 3, "Topic change"),
      historyCommit("main", ["base"], 2, "Main change"),
      historyCommit("base", [], 1, "Base"),
    ]);
    await first.replica.close();

    const reopened = fixture(first.environmentId);

    expect(await reopened.oids(["main"])).toEqual(["main", "base"]);
    expect(await reopened.oids(["topic"])).toEqual(["topic", "base"]);
    const found = await reopened.replica.search(
      { text: "change", limit: 20 },
      new AbortController().signal,
    );
    expect(found.commits.map(({ oid }) => oid)).toEqual(["topic", "main"]);
    expect(found.complete).toBe(true);
    expect(reopened.requests).toEqual([]);
  });

  it("clears the stored history and pauses synchronization until rebuilt", async () => {
    const f = fixture();
    await f.synchronize(tips(["c1"]), [historyCommit("c1", [], 1)]);

    await f.replica.clear();

    expect(await f.oids(["c1"])).toEqual([]);
    expect(f.snapshot().status).toBe("empty");
    await f.replica.rebuild();
    await f.synchronize(tips(["c1"]), [historyCommit("c1", [], 1)]);
    expect(f.requests.at(-1)?.knownTips).toEqual([]);
    expect(await f.oids(["c1"])).toEqual(["c1"]);
  });

  it("ignores a synchronization requested while the cache is being cleared", async () => {
    const f = fixture();
    await f.synchronize(tips(["c1"]), [historyCommit("c1", [], 1)]);

    const cleared = f.replica.clear();
    f.replica.synchronize({ socket: f.socket, repositoryId });
    await cleared;

    expect(f.requests).toHaveLength(1);
    expect(await f.oids(["c1"])).toEqual([]);
    expect(f.snapshot().status).toBe("empty");
  });

  it("keeps a moved branch on its stored tip when the synchronization fails", async () => {
    const f = fixture();
    const main = (oid: string) =>
      ({ name: "main", oid, type: "branch" }) as const;
    await f.synchronize(tips(["c1"], [main("c1")]), [
      historyCommit("c1", [], 1),
    ]);

    await f.fail(tips(["c2"], [main("c2")]));

    expect(await f.oids([main("c2")])).toEqual(["c1"]);
    expect(f.snapshot()).toMatchObject({
      synchronization: "stale",
      refTargets: [main("c1")],
    });
  });
});

function fixture(environmentId: string = crypto.randomUUID()) {
  const snapshots: HistorySnapshot[] = [];
  const requests: SynchronizeRepositoryHistory[] = [];
  let updates: readonly RepositoryHistoryUpdate[] = [];
  let rejection: unknown;
  const socket: EnvironmentSocket = {
    environmentId,
    synchronizeHistory: async (request, accept) => {
      requests.push(request);
      for (const update of updates) await accept(update);
      if (rejection !== undefined) throw rejection;
    },
    closed: new Promise(() => {}),
  };
  const replica = new HistoryReplica(
    environmentId,
    repositoryId,
    (snapshot) => snapshots.push(snapshot),
    () => true,
  );
  onTestFinished(() => replica.close());
  const snapshot = () => snapshots.at(-1) ?? replica.snapshot();
  return {
    environmentId,
    replica,
    requests,
    snapshot,
    socket,
    fail: async (next: RepositoryHistoryUpdate) => {
      updates = [next];
      rejection = { _tag: "Unanswered" };
      replica.synchronize({ socket, repositoryId });
      await expect.poll(() => snapshot().synchronization).toBe("stale");
    },
    synchronize: async (
      next: RepositoryHistoryUpdate,
      commits: readonly RepositoryCommit[],
    ) => {
      const count = requests.length;
      rejection = undefined;
      updates = [next, { _tag: "RepositoryHistoryCommits", commits }];
      replica.synchronize({ socket, repositoryId });
      await expect.poll(() => requests.length).toBe(count + 1);
      await expect.poll(() => snapshot().synchronization).toBe("complete");
    },
    oids: async (roots: readonly (RepositoryHistoryRefTarget | string)[]) => {
      const rows = await replica.rows(historyScope(roots), 0, 100);
      return rows.rows.map(({ commit }) => commit.oid);
    },
  };
}

function tips(
  roots: readonly string[],
  refTargets: readonly RepositoryHistoryRefTarget[] = roots.map((oid) => ({
    name: oid,
    oid,
    type: "branch",
  })),
): RepositoryHistoryUpdate {
  return {
    _tag: "RepositoryHistoryTips",
    objectFormat: "sha1",
    rootOids: roots,
    shallowOids: [],
    refTargets,
  };
}
