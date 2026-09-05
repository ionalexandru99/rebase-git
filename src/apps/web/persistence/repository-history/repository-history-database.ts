import type { StoredCommit } from "#web/persistence/repository-history/repository-history-database.contract";
import { RepositoryHistoryStorageUnavailable } from "#web/persistence/repository-history/repository-history-storage.contract";

export const commitStoreName = "commits";
export const repositoryStoreName = "repositories";

const databaseName = "rebase-repository-history";
const databaseVersion = 5;

export function withRepositoryHistoryDatabase<T>(
  indexedDB: IDBFactory | undefined,
  use: (database: IDBDatabase) => Promise<T>,
) {
  if (indexedDB === undefined) {
    return Promise.reject(
      new RepositoryHistoryStorageUnavailable({
        cause: new Error("IndexedDB is unavailable"),
      }),
    );
  }
  return openDatabase(indexedDB).then(async (database) => {
    try {
      return await use(database);
    } catch (cause) {
      if (cause instanceof DOMException) {
        throw storageUnavailable(cause);
      }
      throw cause;
    } finally {
      database.close();
    }
  });
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolveResult, rejectResult) => {
    request.onsuccess = () => resolveResult(request.result);
    request.onerror = () =>
      rejectResult(
        storageUnavailable(
          request.error ?? new Error("IndexedDB request failed"),
        ),
      );
  });
}

export function transactionCompleted(transaction: IDBTransaction) {
  return new Promise<void>((resolveTransaction, rejectTransaction) => {
    transaction.oncomplete = () => resolveTransaction();
    transaction.onerror = () =>
      rejectTransaction(
        storageUnavailable(
          transaction.error ?? new Error("IndexedDB transaction failed"),
        ),
      );
    transaction.onabort = () =>
      rejectTransaction(
        storageUnavailable(
          transaction.error ?? new Error("IndexedDB transaction aborted"),
        ),
      );
  });
}

export function repositoryCommitRange(key: string, after?: string) {
  return IDBKeyRange.bound(
    after ?? `${key}\0`,
    `${key}\0\uffff`,
    after !== undefined,
  );
}

function openDatabase(indexedDB: IDBFactory) {
  return new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, databaseVersion);
    } catch (cause) {
      rejectDatabase(storageUnavailable(cause));
      return;
    }
    request.onupgradeneeded = (event) => {
      const database = request.result;
      const commits = database.objectStoreNames.contains(commitStoreName)
        ? request.transaction?.objectStore(commitStoreName)
        : database.createObjectStore(commitStoreName, { keyPath: "key" });
      if (commits !== undefined) {
        if (event.oldVersion < 3) backfillTopologicalEpoch(commits);
        for (const index of ["repositoryOrder", "repositorySearch"])
          if (commits.indexNames.contains(index)) commits.deleteIndex(index);
      }
      if (!database.objectStoreNames.contains(repositoryStoreName)) {
        database.createObjectStore(repositoryStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolveDatabase(request.result);
    };
    request.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      rejectDatabase(
        storageUnavailable(request.error ?? new Error("IndexedDB failed")),
      );
    };
    request.onblocked = () => {
      if (settled) {
        return;
      }
      settled = true;
      rejectDatabase(storageUnavailable(new Error("IndexedDB is blocked")));
    };
  });
}

function backfillTopologicalEpoch(commits: IDBObjectStore) {
  const request = commits.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) {
      return;
    }
    const commit = cursor.value as StoredCommit;
    if (
      commit.topologicalOrder !== undefined &&
      commit.topologicalEpoch === undefined
    ) {
      cursor.update({ ...commit, topologicalEpoch: 0 } satisfies StoredCommit);
    }
    cursor.continue();
  };
}

function storageUnavailable(cause: unknown) {
  return cause instanceof RepositoryHistoryStorageUnavailable
    ? cause
    : new RepositoryHistoryStorageUnavailable({ cause });
}
