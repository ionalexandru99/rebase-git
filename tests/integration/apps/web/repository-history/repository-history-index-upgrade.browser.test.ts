import type { RepositoryCommit } from "@rebase/contracts";
import { expect, it } from "vitest";
import type { HistoryOrderCache } from "#web/features/repository-history/query/history-order.contract";
import { prepareRepositoryHistoryOrder } from "#web/features/repository-history/query/repository-history-query";
import {
  commitStoreName,
  repositoryStoreName,
  requestResult,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";
import {
  emptyStoredRepository,
  storedCommit,
} from "#web/persistence/repository-history/repository-history-records";

it.each([2, 4])(
  "preserves history and ordering when upgrading a version-%i cache",
  async (version) => {
    const factory = isolatedFactory();
    const environmentId = "environment";
    const repositoryId = "repository";
    const records = [
      record("f0", ["b0", "10"], 5, 0, 0),
      record("b0", ["00"], 1, 0, 1),
      record("10", ["00"], 10, 0, 2),
      record("00", [], 0, 0, 3),
      record("c0", [], 0, version === 2 ? 0 : -1, -1),
      record("d0", [], 0, version === 2 ? 0 : -1, -1),
      record("99", [], 100, undefined, undefined),
    ];
    const repository = {
      ...emptyStoredRepository(environmentId, repositoryId, "sha1"),
      completion: { commitCount: records.length },
      progress: { committedCommitCount: records.length, nextBatchSequence: 1 },
      refTargets: [{ name: "main", oid: oid("f0"), type: "branch" as const }],
    };
    const legacyRecords = records.map((record) => {
      if (version !== 2) return record;
      const { topologicalEpoch: _, ...legacy } = record;
      return legacy;
    });
    await createOldCache(factory, version, legacyRecords, repository);
    try {
      await withRepositoryHistoryDatabase(factory, async (database) => {
        expect(database.version).toBe(5);
        const transaction = database.transaction([
          commitStoreName,
          repositoryStoreName,
        ]);
        const completed = transactionCompleted(transaction);
        const commits = transaction.objectStore(commitStoreName);
        expect([...commits.indexNames]).toEqual([]);
        expect(await requestResult(commits.getAll())).toEqual(
          records.toSorted((left, right) => (left.key < right.key ? -1 : 1)),
        );
        expect(
          await requestResult(
            transaction.objectStore(repositoryStoreName).get(repository.key),
          ),
        ).toEqual(repository);
        await completed;
      });
      const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
      await prepareRepositoryHistoryOrder(
        environmentId,
        repositoryId,
        cache,
        factory,
      );
      const roots = ["f0", "d0", "c0", "99"].map(oid);
      expect(cache.index?.order(roots, "topological")).toEqual(
        ["c0", "d0", "f0", "b0", "10", "00"].map(oid),
      );
      expect(cache.index?.order(roots, "chronological")).toEqual(
        ["f0", "10", "b0", "c0", "d0", "00"].map(oid),
      );
    } finally {
      await requestResult(factory.deleteDatabase("ignored"));
    }
  },
);

it("continues primary scans past a full chunk without stored positions", async () => {
  const factory = isolatedFactory();
  const records = Array.from({ length: 2_049 }, (_, index) =>
    record(
      index.toString(16),
      [],
      index,
      index === 2_048 ? 0 : undefined,
      index === 2_048 ? 0 : undefined,
    ),
  );
  await createOldCache(factory, 4, records);
  try {
    const cache: HistoryOrderCache = { queries: new Map(), revision: 0 };
    await prepareRepositoryHistoryOrder(
      "environment",
      "repository",
      cache,
      factory,
    );
    expect(
      cache.index?.order(
        records.map(({ commit }) => commit.oid),
        "topological",
      ),
    ).toEqual([oid("800")]);
  } finally {
    await requestResult(factory.deleteDatabase("ignored"));
  }
});

function oid(value: string) {
  return value.padStart(40, "0");
}

function record(
  value: string,
  parents: string[],
  timestamp: number,
  epoch: number | undefined,
  order: number | undefined,
): StoredCommit {
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    timestampSeconds: timestamp,
    timezoneOffsetMinutes: 0,
  };
  const commit: RepositoryCommit = {
    oid: oid(value),
    parents: parents.map(oid),
    subject: value,
    author: identity,
    committer: identity,
  };
  return storedCommit(
    "environment",
    "repository",
    commit,
    epoch === undefined || order === undefined ? undefined : { epoch, order },
  );
}

function isolatedFactory(): IDBFactory {
  const name = `history-index-upgrade-${crypto.randomUUID()}`;
  return {
    open: (_name, version) => indexedDB.open(name, version),
    deleteDatabase: () => indexedDB.deleteDatabase(name),
    databases: () => indexedDB.databases(),
    cmp: (left, right) => indexedDB.cmp(left, right),
  };
}

async function createOldCache(
  factory: IDBFactory,
  version: number,
  records: readonly StoredCommit[],
  repository?: ReturnType<typeof emptyStoredRepository>,
) {
  const opened = factory.open("ignored", version);
  opened.onupgradeneeded = () => {
    const database = opened.result;
    const commits = database.createObjectStore(commitStoreName, {
      keyPath: "key",
    });
    commits.createIndex(
      "repositoryOrder",
      version === 2
        ? ["environmentId", "repositoryId", "topologicalOrder"]
        : [
            "environmentId",
            "repositoryId",
            "topologicalEpoch",
            "topologicalOrder",
          ],
    );
    if (version === 4)
      commits.createIndex("repositorySearch", [
        "environmentId",
        "repositoryId",
        "commit.committer.timestampSeconds",
        "commit.oid",
      ]);
    for (const record of [...records].reverse()) commits.put(record);
    const repositories = database.createObjectStore(repositoryStoreName, {
      keyPath: "key",
    });
    if (repository !== undefined) repositories.put(repository);
  };
  const database = await requestResult(opened);
  database.close();
}
