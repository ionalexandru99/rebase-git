import {
  commitStoreName,
  readRepositoryRecord,
  repositoryCommitRange,
  repositoryStoreName,
  requestResult,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";
import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";
import type { RepositoryHistorySearchRecords } from "#web/persistence/repository-history/repository-history-transaction.contract";

export function withHistorySearchRecords<T>(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined,
  read: (records: RepositoryHistorySearchRecords) => Promise<T>,
) {
  return withRepositoryHistoryDatabase(indexedDB, (database) =>
    read({
      readRepository: () =>
        readSearchState(environmentId, repositoryId, database),
      readChunk: (repository, after, limit) =>
        readSearchChunk(repository, after, limit, database),
    }),
  );
}

async function readSearchState(
  environmentId: string,
  repositoryId: string,
  database: IDBDatabase,
) {
  const transaction = database.transaction(repositoryStoreName, "readonly");
  const completed = transactionCompleted(transaction);
  const state = await readRepositoryRecord(
    transaction.objectStore(repositoryStoreName),
    environmentId,
    repositoryId,
  );
  await completed;
  return state;
}

async function readSearchChunk(
  repository: number,
  after: string | undefined,
  limit: number,
  database: IDBDatabase,
) {
  const transaction = database.transaction(commitStoreName, "readonly");
  const completed = transactionCompleted(transaction);
  const records = await requestResult<StoredCommit[]>(
    transaction
      .objectStore(commitStoreName)
      .getAll(repositoryCommitRange(repository, after), limit),
  );
  await completed;
  return records;
}
