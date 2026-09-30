import type {
  RepositoryCommit,
  RepositoryHistoryUpdate,
} from "#contracts/repository-history/repository-history.contract.ts";
import type { HistorySnapshot } from "#web/features/repository-history/history-worker-protocol.ts";
import { HistoryReplica } from "#web/features/repository-history/worker/history-replica.ts";
import { describeHistoryStorage } from "#web/features/repository-history/worker/history-storage.ts";
import type { EnvironmentSocket } from "#web/platform/environment/environment-connection.ts";

const environmentId = crypto.randomUUID();
const put = IDBObjectStore.prototype.put;
let armed = false;
let quotaTriggered = false;
const open = new Set<string>();

IDBObjectStore.prototype.put = function (value, key) {
  if (armed && this.name === "commits") {
    armed = false;
    quotaTriggered = true;
    throw new DOMException("Injected storage pressure", "QuotaExceededError");
  }
  return put.call(this, value, key);
};

self.onmessage = async ({ data }: MessageEvent<"seed" | "run">) => {
  if (data === "seed") {
    await Promise.all([visible, maintenance, closed].map(seed));
    await closed.replica.close();
    open.delete(closed.repositoryId);
    self.postMessage({ _tag: "Seeded", visible: visible.repositoryId });
    return;
  }
  await maintenance.replica.clear();
  armed = true;
  await maintenance.replica.rebuild();
  await seed(maintenance);
  const storage = await describeHistoryStorage((_, repositoryId) =>
    open.has(repositoryId),
  );
  const cache = (repositoryId: string) =>
    storage.caches.find((item) => item.repositoryId === repositoryId);
  self.postMessage({
    _tag: "Maintained",
    quotaTriggered,
    visible: cache(visible.repositoryId),
    rebuilt: cache(maintenance.repositoryId),
    pruned: cache(closed.repositoryId),
  });
};

const visible = fixture(500);
const maintenance = fixture(20_000);
const closed = fixture(20_000, true);

function fixture(count: number, disconnected = false) {
  const repositoryId = crypto.randomUUID();
  open.add(repositoryId);
  const oid = (index: number) => index.toString(16).padStart(40, "0");
  const commits: RepositoryCommit[] = Array.from(
    { length: count },
    (_, index) => {
      const identity = {
        name: "Storage benchmark",
        email: "storage@example.test",
        timestampSeconds: count - index,
        timezoneOffsetMinutes: 0,
      };
      return {
        oid: oid(index),
        parents: disconnected || index === count - 1 ? [] : [oid(index + 1)],
        subject: `Storage commit ${index}`,
        author: identity,
        committer: identity,
      };
    },
  );
  const updates: RepositoryHistoryUpdate[] = [
    {
      _tag: "RepositoryHistoryTips",
      objectFormat: "sha1",
      rootOids: [oid(0)],
      shallowOids: [],
      refTargets: [{ name: "main", oid: oid(0), type: "branch" }],
    },
    ...Array.from({ length: Math.ceil(count / 500) }, (_, batch) => ({
      _tag: "RepositoryHistoryCommits" as const,
      commits: commits.slice(batch * 500, (batch + 1) * 500),
    })),
  ];
  let completed: (() => void) | undefined;
  const replica = new HistoryReplica(
    environmentId,
    repositoryId,
    (snapshot: HistorySnapshot) => {
      if (snapshot.synchronization === "complete") completed?.();
    },
    (_, repository) => open.has(repository),
  );
  const socket: EnvironmentSocket = {
    environmentId,
    synchronizeHistory: async (_request, accept) => {
      for (const update of updates) await accept(update);
    },
    closed: new Promise(() => {}),
  };
  return {
    repositoryId,
    replica,
    socket,
    done: (resolve: () => void) => {
      completed = resolve;
    },
  };
}

function seed(data: ReturnType<typeof fixture>) {
  return new Promise<void>((resolve) => {
    data.done(resolve);
    data.replica.synchronize({
      socket: data.socket,
      repositoryId: data.repositoryId,
    });
  });
}
