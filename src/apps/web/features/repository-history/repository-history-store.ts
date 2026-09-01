import type { RepositoryCommit } from "@rebase/contracts";

const databaseName = "rebase-repository-history";
const databaseVersion = 1;
const commitStoreName = "commits";

export function storeRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  indexedDB: IDBFactory = globalThis.indexedDB,
) {
  return withDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readwrite");
    const store = transaction.objectStore(commitStoreName);
    for (const commit of commits) {
      store.put({
        commit,
        key: commitKey(environmentId, repositoryId, commit.oid),
      } satisfies StoredCommit);
    }
    await transactionCompleted(transaction);
  });
}

export function readRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
  indexedDB: IDBFactory = globalThis.indexedDB,
) {
  if (oids.length > 1_000)
    return Promise.reject(new Error("Query is too large"));
  return withDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const store = transaction.objectStore(commitStoreName);
    const records = await Promise.all(
      oids.map((oid) =>
        requestResult<StoredCommit | undefined>(
          store.get(commitKey(environmentId, repositoryId, oid)),
        ),
      ),
    );
    await transactionCompleted(transaction);
    return records.flatMap((record) =>
      record === undefined ? [] : [record.commit],
    );
  });
}

function withDatabase<T>(
  indexedDB: IDBFactory,
  use: (database: IDBDatabase) => Promise<T>,
) {
  return openDatabase(indexedDB).then(async (database) => {
    try {
      return await use(database);
    } finally {
      database.close();
    }
  });
}

function openDatabase(indexedDB: IDBFactory) {
  return new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(commitStoreName)) {
        database.createObjectStore(commitStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolveDatabase(request.result);
    request.onerror = () =>
      rejectDatabase(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () => rejectDatabase(new Error("IndexedDB is blocked"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolveResult, rejectResult) => {
    request.onsuccess = () => resolveResult(request.result);
    request.onerror = () =>
      rejectResult(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionCompleted(transaction: IDBTransaction) {
  return new Promise<void>((resolveTransaction, rejectTransaction) => {
    transaction.oncomplete = () => resolveTransaction();
    transaction.onerror = () =>
      rejectTransaction(
        transaction.error ?? new Error("IndexedDB transaction failed"),
      );
    transaction.onabort = () =>
      rejectTransaction(
        transaction.error ?? new Error("IndexedDB transaction aborted"),
      );
  });
}

function commitKey(environmentId: string, repositoryId: string, oid: string) {
  return `${environmentId}\0${repositoryId}\0${oid}`;
}

interface StoredCommit {
  readonly commit: RepositoryCommit;
  readonly key: string;
}
