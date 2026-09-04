import { RepositoryRefs } from "@rebase/contracts";
import { Schema } from "effect";

const databaseName = "rebase-repository-refs";
const storeName = "repositories";

export async function readCachedRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
): Promise<RepositoryRefs | undefined> {
  try {
    const value = await accessCache("readonly", (store) =>
      store.get([environmentId, logicalRepositoryId]),
    );
    if (value === undefined) return undefined;
    const refs = Schema.decodeUnknownSync(RepositoryRefs)(value);
    return (refs.logicalRepositoryId ?? refs.repositoryId) ===
      logicalRepositoryId
      ? refs
      : undefined;
  } catch {
    return undefined;
  }
}

export async function cacheRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
  refs: RepositoryRefs,
): Promise<void> {
  if ((refs.logicalRepositoryId ?? refs.repositoryId) !== logicalRepositoryId)
    return;
  try {
    await accessCache("readwrite", (store) =>
      store.put(refs, [environmentId, logicalRepositoryId]),
    );
  } catch {
    return;
  }
}

export async function clearCachedRepositoryRefs(
  environmentId: string,
  logicalRepositoryId: string,
): Promise<void> {
  await accessCache("readwrite", (store) =>
    store.delete([environmentId, logicalRepositoryId]),
  );
}

export async function clearAllCachedRepositoryRefs(): Promise<void> {
  await accessCache("readwrite", (store) => store.clear());
}

function accessCache<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(databaseName, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(storeName);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      database.onversionchange = () => database.close();
      const transaction = database.transaction(storeName, mode);
      const operation = request(transaction.objectStore(storeName));
      transaction.oncomplete = () => {
        database.close();
        resolve(operation.result);
      };
      transaction.onabort = transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}
