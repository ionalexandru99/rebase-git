import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
} from "@rebase/contracts";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/features/repository-history/repository-history-completion";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";

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

export function emptyStoredRepository(
  environmentId: string,
  repositoryId: string,
  objectFormat: "sha1" | "sha256",
): StoredRepository {
  return {
    environmentId,
    key: repositoryKey(environmentId, repositoryId),
    cacheFormatVersion: 1,
    lastOpenedAt: Date.now(),
    objectFormat,
    minimumTopologicalEpoch: 0,
    progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    refTargets: [],
    repositoryId,
  };
}

export function storedCommit(
  environmentId: string,
  repositoryId: string,
  commit: RepositoryCommit,
  topologicalPosition?: {
    readonly epoch: number;
    readonly order: number;
  },
): StoredCommit {
  return {
    commit,
    environmentId,
    key: commitKey(environmentId, repositoryId, commit.oid),
    repositoryId,
    ...(topologicalPosition === undefined
      ? {}
      : {
          topologicalEpoch: topologicalPosition.epoch,
          topologicalOrder: topologicalPosition.order,
        }),
  };
}

export function repositoryKey(environmentId: string, repositoryId: string) {
  return `${environmentId}\0${repositoryId}`;
}

export function repositoryCommitRange(key: string, after?: string) {
  return IDBKeyRange.bound(
    after ?? `${key}\0`,
    `${key}\0\uffff`,
    after !== undefined,
  );
}

export function commitKey(
  environmentId: string,
  repositoryId: string,
  oid: string,
) {
  return `${repositoryKey(environmentId, repositoryId)}\0${oid}`;
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

export interface StoredCommit {
  readonly commit: RepositoryCommit;
  readonly environmentId: string;
  readonly key: string;
  readonly repositoryId: string;
  readonly topologicalEpoch?: number;
  readonly topologicalOrder?: number;
}

export interface StoredHistoryPage {
  readonly offset?: number;
  readonly exhausted?: boolean;
  readonly scopeKey?: string;
  readonly oids: readonly string[];
  readonly order: RepositoryHistoryQuery["order"];
  readonly requestedLimit: number;
  readonly rootOids: readonly string[];
}

export interface StoredRepository {
  readonly cacheFormatVersion?: number;
  readonly lastOpenedAt?: number;
  readonly cachedPage?: StoredHistoryPage;
  readonly foregroundPages?: readonly StoredHistoryPage[];
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly environmentId: string;
  readonly key: string;
  readonly minimumTopologicalEpoch: number;
  readonly objectFormat: "sha1" | "sha256";
  readonly pendingTopologicalEpoch?: number;
  readonly pendingTopologicalOrder?: number;
  readonly pendingSnapshot?: RepositoryHistorySnapshot;
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly repositoryId: string;
}
