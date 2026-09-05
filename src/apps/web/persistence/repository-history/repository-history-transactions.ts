import type { RepositoryCommit } from "@rebase/contracts";
import {
  commitStoreName,
  repositoryCommitRange,
  repositoryStoreName,
  requestResult,
  topologyStoreName,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type {
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";
import {
  commitKey,
  repositoryKey,
  storedCommit,
} from "#web/persistence/repository-history/repository-history-records";
import type {
  RepositoryHistoryReadTransaction,
  RepositoryHistoryRepositoryTransaction,
  RepositoryHistoryWriteTransaction,
} from "#web/persistence/repository-history/repository-history-transaction.contract";

export function readStoredHistory<T>(
  indexedDB: IDBFactory | undefined,
  read: (transaction: RepositoryHistoryReadTransaction) => Promise<T>,
) {
  return withRepositoryHistoryDatabase(indexedDB, (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readonly",
    );
    return read(historyReadTransaction(transaction));
  });
}

export function updateStoredHistory<T>(
  indexedDB: IDBFactory | undefined,
  update: (transaction: RepositoryHistoryWriteTransaction) => Promise<T>,
) {
  return withRepositoryHistoryDatabase(indexedDB, (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName, topologyStoreName],
      "readwrite",
    );
    const commits = transaction.objectStore(commitStoreName);
    const repositories = transaction.objectStore(repositoryStoreName);
    const topologies = transaction.objectStore(topologyStoreName);
    const invalidated = new Set<string>();
    const invalidateTopology = (key: string) => {
      if (invalidated.has(key)) return;
      invalidated.add(key);
      topologies.delete(key);
    };
    return update({
      ...historyReadTransaction(transaction),
      storeRepository: (record) => {
        repositories.put(record);
      },
      storeCommit: (record) => {
        commits.put(record);
        invalidateTopology(
          repositoryKey(record.environmentId, record.repositoryId),
        );
      },
      readCommitChunk: (key, after, limit) =>
        requestResult<StoredCommit[]>(
          commits.getAll(repositoryCommitRange(key, after), limit),
        ),
      countCommits: (key) =>
        requestResult(commits.count(repositoryCommitRange(key))),
      deleteCommit: (key) => {
        commits.delete(key);
        invalidateTopology(key.slice(0, key.lastIndexOf("\0")));
      },
      deleteRepositoryCommits: (key) => {
        commits.delete(repositoryCommitRange(key));
        invalidateTopology(key);
      },
      deleteRepository: (key) => {
        repositories.delete(key);
        invalidateTopology(key);
      },
    });
  });
}

export function updateStoredRepository<T>(
  indexedDB: IDBFactory | undefined,
  update: (transaction: RepositoryHistoryRepositoryTransaction) => Promise<T>,
) {
  return withRepositoryHistoryDatabase(indexedDB, (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    return update({
      completed,
      readRepository: (key) =>
        requestResult<StoredRepository | undefined>(repositories.get(key)),
      storeRepository: (record) => {
        repositories.put(record);
      },
    });
  });
}

export function readStoredRepository(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const repository = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    await completed;
    return repository;
  });
}

export function readStoredCommits(
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const records = await Promise.all(
      oids.map((oid) =>
        requestResult<StoredCommit | undefined>(
          commits.get(commitKey(environmentId, repositoryId, oid)),
        ),
      ),
    );
    await completed;
    return records;
  });
}

export function storeRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, topologyStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(commitStoreName);
    transaction
      .objectStore(topologyStoreName)
      .delete(repositoryKey(environmentId, repositoryId));
    for (const commit of commits)
      store.put(storedCommit(environmentId, repositoryId, commit));
    await completed;
  });
}

function historyReadTransaction(
  transaction: IDBTransaction,
): RepositoryHistoryReadTransaction {
  const completed = transactionCompleted(transaction);
  const commits = transaction.objectStore(commitStoreName);
  const repositories = transaction.objectStore(repositoryStoreName);
  return {
    completed,
    readRepository: (key) =>
      requestResult<StoredRepository | undefined>(repositories.get(key)),
    readCommit: (key) =>
      requestResult<StoredCommit | undefined>(commits.get(key)),
  };
}
