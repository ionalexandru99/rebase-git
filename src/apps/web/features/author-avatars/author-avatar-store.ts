export interface CachedAvatar {
  readonly url: string | undefined;
  readonly expires: number;
}

export interface AuthorAvatarStore {
  readonly load: (
    provider: string,
  ) => Promise<ReadonlyMap<string, CachedAvatar>>;
  readonly save: (
    provider: string,
    email: string,
    avatar: CachedAvatar,
  ) => void;
}

interface StoredAvatar extends CachedAvatar {
  readonly provider: string;
  readonly email: string;
}

const databaseName = "rebase-author-avatars";
const storeName = "avatars";
let connection: Promise<IDBDatabase> | undefined;

export const browserAvatarStore: AuthorAvatarStore = {
  load: async (provider) => {
    const avatars = new Map<string, CachedAvatar>();
    const database = await sharedDatabase().catch(() => undefined);
    if (database === undefined) return avatars;
    const now = Date.now();
    const transaction = database.transaction(storeName, "readwrite");
    const request = transaction
      .objectStore(storeName)
      .openCursor(IDBKeyRange.bound([provider], [provider, []]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) return;
      const stored: unknown = cursor.value;
      if (isStoredAvatar(stored) && stored.expires > now)
        avatars.set(stored.email, { url: stored.url, expires: stored.expires });
      else cursor.delete();
      cursor.continue();
    };
    await settled(transaction);
    return avatars;
  },
  save: (provider, email, avatar) => {
    sharedDatabase().then(
      (database) => {
        const stored: StoredAvatar = { provider, email, ...avatar };
        database
          .transaction(storeName, "readwrite")
          .objectStore(storeName)
          .put(stored);
      },
      () => undefined,
    );
  },
};

function sharedDatabase() {
  connection ??= openDatabase().catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(storeName, {
        keyPath: ["provider", "email"],
      });
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        connection = undefined;
        database.close();
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

function settled(transaction: IDBTransaction) {
  return new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function isStoredAvatar(value: unknown): value is StoredAvatar {
  if (typeof value !== "object" || value === null) return false;
  const stored = value as Partial<StoredAvatar>;
  return (
    typeof stored.email === "string" &&
    typeof stored.expires === "number" &&
    (stored.url === undefined || typeof stored.url === "string")
  );
}
