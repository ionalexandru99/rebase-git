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

export function readHistoryCacheRecords(indexedDB = globalThis.indexedDB) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const records = await requestResult<StoredRepository[]>(
      transaction.objectStore(repositoryStoreName).getAll(),
    );
    await completed;
    return records;
  });
}

export async function visitHistoryCacheCommits(
  key: string,
  visit: (commit: StoredCommit) => void,
  indexedDB: IDBFactory,
) {
  let after: string | undefined;
  for (;;) {
    const lastKey = await withRepositoryHistoryDatabase(
      indexedDB,
      async (database) => {
        const transaction = database.transaction(commitStoreName, "readonly");
        const completed = transactionCompleted(transaction);
        const records = await requestResult<StoredCommit[]>(
          transaction
            .objectStore(commitStoreName)
            .getAll(repositoryCommitRange(key, after), 256),
        );
        for (const commit of records) visit(commit);
        await completed;
        return records.length === 256 ? records.at(-1)?.key : undefined;
      },
    );
    if (lastKey === undefined) return;
    after = lastKey;
  }
}
