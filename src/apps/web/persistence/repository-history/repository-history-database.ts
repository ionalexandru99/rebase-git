import type { StoredRepository } from "#web/persistence/repository-history/repository-history-database.contract";
import { RepositoryHistoryStorageUnavailable } from "#web/persistence/repository-history/repository-history-storage.contract";

export const commitStoreName = "commits";
export const repositoryStoreName = "repositories";
export const topologyStoreName = "topology";
export const workingChangesStoreName = "workingChanges";
const repositoryIdentityIndexName = "identity";

const databaseName = "rebase-repository-history";
const databaseVersion = 8;
const historyStoreNames = [
  commitStoreName,
  repositoryStoreName,
  topologyStoreName,
];

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

export function repositoryCommitRange(repository: number, after?: string) {
  return IDBKeyRange.bound(
    [repository, after ?? ""],
    [repository, []],
    after !== undefined,
    true,
  );
}

export function readRepositoryRecord(
  repositories: IDBObjectStore,
  environmentId: string,
  repositoryId: string,
) {
  return requestResult<StoredRepository | undefined>(
    repositories
      .index(repositoryIdentityIndexName)
      .get([environmentId, repositoryId]),
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
    request.onupgradeneeded = () => recreateHistoryStores(request.result);
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

function recreateHistoryStores(database: IDBDatabase) {
  for (const name of historyStoreNames)
    if (database.objectStoreNames.contains(name))
      database.deleteObjectStore(name);
  if (!database.objectStoreNames.contains(workingChangesStoreName))
    database.createObjectStore(workingChangesStoreName);
  database.createObjectStore(commitStoreName);
  database.createObjectStore(topologyStoreName);
  database
    .createObjectStore(repositoryStoreName, {
      keyPath: "id",
      autoIncrement: true,
    })
    .createIndex(
      repositoryIdentityIndexName,
      ["environmentId", "repositoryId"],
      {
        unique: true,
      },
    );
}

function storageUnavailable(cause: unknown) {
  return cause instanceof RepositoryHistoryStorageUnavailable
    ? cause
    : new RepositoryHistoryStorageUnavailable({ cause });
}
