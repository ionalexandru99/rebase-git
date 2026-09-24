import type { RepositoryCommit } from "@rebase/contracts";
import { expect, it } from "vitest";
import type { HistoryOrderCache } from "#web/features/repository-history/query/history-order.contract";
import { prepareRepositoryHistoryOrder } from "#web/features/repository-history/query/repository-history-query";
import {
  storeRepositoryHistoryBatch,
  storeRepositoryHistoryPage,
} from "#web/features/repository-history/replica/repository-history-store";
import {
  commitStoreName,
  repositoryStoreName,
  requestResult,
  topologyStoreName,
  transactionCompleted,
  withRepositoryHistoryDatabase,
  workingChangesStoreName,
} from "#web/persistence/repository-history/repository-history-database";

it("drops history caches from an older version and keeps working changes", async () => {
  const factory = isolatedFactory();
  const opened = factory.open("ignored", 7);
  opened.onupgradeneeded = () => {
    const database = opened.result;
    database
      .createObjectStore(commitStoreName, { keyPath: "key" })
      .put({ key: "environment\0repository\0oid" });
    database
      .createObjectStore(repositoryStoreName, { keyPath: "key" })
      .put({ key: "environment\0repository" });
    database.createObjectStore(topologyStoreName).put({}, "topology");
    database
      .createObjectStore(workingChangesStoreName)
      .put({ split: true }, "preferences");
  };
  (await requestResult(opened)).close();
  try {
    await withRepositoryHistoryDatabase(factory, async (database) => {
      const transaction = database.transaction([
        commitStoreName,
        repositoryStoreName,
        topologyStoreName,
        workingChangesStoreName,
      ]);
      const completed = transactionCompleted(transaction);
      const count = (name: string) =>
        requestResult(transaction.objectStore(name).count());
      expect(await count(commitStoreName)).toBe(0);
      expect(await count(repositoryStoreName)).toBe(0);
      expect(await count(topologyStoreName)).toBe(0);
      expect(
        await requestResult(
          transaction.objectStore(workingChangesStoreName).get("preferences"),
        ),
      ).toEqual({ split: true });
      await completed;
    });
  } finally {
    await requestResult(factory.deleteDatabase("ignored"));
  }
});

it("continues primary scans past a full chunk without stored positions", async () => {
  const factory = isolatedFactory();
  const commits = Array.from({ length: 2_049 }, (_, index) =>
    commit(index.toString(16)),
  );
  const roots = [{ name: "main", oid: oid("800"), type: "branch" as const }];
  await storeRepositoryHistoryPage(
    "environment",
    "repository",
    {
      commits: commits.slice(0, 2_048),
      objectFormat: "sha1",
      refTargets: roots,
      repositoryId: "repository",
      requestId: crypto.randomUUID(),
    },
    { limit: 2_048, order: "topological", roots },
    factory,
  );
  await storeRepositoryHistoryBatch(
    "environment",
    "repository",
    {
      commits: commits.slice(2_048),
      objectFormat: "sha1",
      repositoryId: "repository",
      requestId: crypto.randomUUID(),
      sequence: 0,
    },
    factory,
  );
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
        commits.map(({ oid }) => oid),
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

function commit(value: string): RepositoryCommit {
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    timestampSeconds: 0,
    timezoneOffsetMinutes: 0,
  };
  return {
    oid: oid(value),
    parents: [],
    subject: value,
    author: identity,
    committer: identity,
  };
}

function isolatedFactory(): IDBFactory {
  const name = `history-database-${crypto.randomUUID()}`;
  return {
    open: (_name, version) => indexedDB.open(name, version),
    deleteDatabase: () => indexedDB.deleteDatabase(name),
    databases: () => indexedDB.databases(),
    cmp: (left, right) => indexedDB.cmp(left, right),
  };
}
