import {
  commitStoreName,
  repositoryCommitRange,
  repositoryStoreName,
  requestResult,
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
} from "#web/persistence/repository-history/repository-history-records";
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
      readChunk: (after, limit) =>
        readSearchChunk(environmentId, repositoryId, after, limit, database),
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
  const state = await requestResult<StoredRepository | undefined>(
    transaction
      .objectStore(repositoryStoreName)
      .get(repositoryKey(environmentId, repositoryId)),
  );
  await completed;
  return state;
}

async function readSearchChunk(
  environmentId: string,
  repositoryId: string,
  after: string | undefined,
  limit: number,
  database: IDBDatabase,
) {
  const transaction = database.transaction(commitStoreName, "readonly");
  const completed = transactionCompleted(transaction);
  const range = repositoryCommitRange(
    repositoryKey(environmentId, repositoryId),
    after === undefined
      ? undefined
      : commitKey(environmentId, repositoryId, after),
  );
  const records = await requestResult<StoredCommit[]>(
    transaction.objectStore(commitStoreName).getAll(range, limit),
  );
  await completed;
  return records;
}
