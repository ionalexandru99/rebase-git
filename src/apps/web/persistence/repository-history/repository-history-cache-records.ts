import {
  repositoryStoreName,
  requestResult,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/persistence/repository-history/repository-history-database";

import type { StoredRepository } from "#web/persistence/repository-history/repository-history-database.contract";

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
