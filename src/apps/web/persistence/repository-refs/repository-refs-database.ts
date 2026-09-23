const databaseName = "rebase-repository-refs";
const storeName = "repositories";

export function accessRepositoryRefsStore<T>(
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
