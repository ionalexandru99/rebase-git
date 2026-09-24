import {
  commitStoreName,
  readRepositoryRecord,
  repositoryCommitRange,
  repositoryStoreName,
  requestResult,
  topologyStoreName,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type {
  NewStoredRepository,
  StoredCommit,
  StoredRepository,
} from "#web/persistence/repository-history/repository-history-database.contract";
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
    const invalidated = new Set<number>();
    const invalidateTopology = (repository: number) => {
      if (invalidated.has(repository)) return;
      invalidated.add(repository);
      topologies.delete(repository);
    };
    return abortOnFailure(transaction, update, {
      ...historyReadTransaction(transaction),
      storeRepository: (record) => storeRepositoryRecord(repositories, record),
      storeCommit: (repository, record) => {
        commits.put(record, [repository, record.commit.oid]);
        invalidateTopology(repository);
      },
      deleteRepositoryCommits: (repository) => {
        commits.delete(repositoryCommitRange(repository));
        invalidateTopology(repository);
      },
      deleteRepository: (repository) => {
        repositories.delete(repository);
        invalidateTopology(repository);
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
    return abortOnFailure(transaction, update, {
      completed,
      readRepository: (environmentId, repositoryId) =>
        readRepositoryRecord(repositories, environmentId, repositoryId),
      storeRepository: (record) => storeRepositoryRecord(repositories, record),
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
    const repository = await readRepositoryRecord(
      transaction.objectStore(repositoryStoreName),
      environmentId,
      repositoryId,
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
  return readStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const repository = await transaction.readRepository(
      environmentId,
      repositoryId,
    );
    const records =
      repository === undefined
        ? oids.map(() => undefined)
        : await Promise.all(
            oids.map((oid) => transaction.readCommit(repository.id, oid)),
          );
    await completed;
    return records;
  });
}

async function abortOnFailure<
  Records extends { readonly completed: Promise<void> },
  T,
>(
  transaction: IDBTransaction,
  update: (records: Records) => Promise<T>,
  records: Records,
) {
  try {
    return await update(records);
  } catch (error) {
    records.completed.catch(() => undefined);
    try {
      transaction.abort();
    } catch {}
    throw error;
  }
}

function storeRepositoryRecord(
  repositories: IDBObjectStore,
  record: StoredRepository | NewStoredRepository,
) {
  return requestResult(repositories.put(record)).then((key) => Number(key));
}

function historyReadTransaction(
  transaction: IDBTransaction,
): RepositoryHistoryReadTransaction {
  const completed = transactionCompleted(transaction);
  const commits = transaction.objectStore(commitStoreName);
  const repositories = transaction.objectStore(repositoryStoreName);
  return {
    completed,
    readRepository: (environmentId, repositoryId) =>
      readRepositoryRecord(repositories, environmentId, repositoryId),
    readCommit: (repository, oid) =>
      requestResult<StoredCommit | undefined>(commits.get([repository, oid])),
  };
}
