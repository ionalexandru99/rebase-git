import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/features/repository-history/repository-history-completion";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";
import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";

export const commitStoreName = "commits";
export const repositoryStoreName = "repositories";
export const repositoryOrderIndexName = "repositoryOrder";

const databaseName = "rebase-repository-history";
const databaseVersion = 2;

export function withRepositoryHistoryDatabase<T>(
  indexedDB: IDBFactory | undefined,
  use: (database: IDBDatabase) => Promise<T>,
) {
  if (indexedDB === undefined) {
    return Promise.reject(new RepositoryHistoryStorageUnavailable());
  }
  return openDatabase(indexedDB)
    .then(async (database) => {
      try {
        return await use(database);
      } finally {
        database.close();
      }
    })
    .catch((cause: unknown) => {
      if (cause instanceof RepositoryHistoryStorageUnavailable) {
        throw cause;
      }
      throw new RepositoryHistoryStorageUnavailable();
    });
}

export function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolveResult, rejectResult) => {
    request.onsuccess = () => resolveResult(request.result);
    request.onerror = () =>
      rejectResult(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function transactionCompleted(transaction: IDBTransaction) {
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

export function emptyStoredRepository(
  environmentId: string,
  repositoryId: string,
  objectFormat: "sha1" | "sha256",
): StoredRepository {
  return {
    environmentId,
    key: repositoryKey(environmentId, repositoryId),
    objectFormat,
    progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    refTargets: [],
    repositoryId,
  };
}

export function storedCommit(
  environmentId: string,
  repositoryId: string,
  commit: RepositoryCommit,
  topologicalOrder?: number,
): StoredCommit {
  return {
    commit,
    environmentId,
    key: commitKey(environmentId, repositoryId, commit.oid),
    repositoryId,
    ...(topologicalOrder === undefined ? {} : { topologicalOrder }),
  };
}

export function repositoryKey(environmentId: string, repositoryId: string) {
  return `${environmentId}\0${repositoryId}`;
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
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      const commits = database.objectStoreNames.contains(commitStoreName)
        ? request.transaction?.objectStore(commitStoreName)
        : database.createObjectStore(commitStoreName, { keyPath: "key" });
      if (
        commits !== undefined &&
        !commits.indexNames.contains(repositoryOrderIndexName)
      ) {
        commits.createIndex(repositoryOrderIndexName, [
          "environmentId",
          "repositoryId",
          "topologicalOrder",
        ]);
      }
      if (!database.objectStoreNames.contains(repositoryStoreName)) {
        database.createObjectStore(repositoryStoreName, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolveDatabase(request.result);
    request.onerror = () =>
      rejectDatabase(request.error ?? new Error("IndexedDB failed"));
    request.onblocked = () => rejectDatabase(new Error("IndexedDB is blocked"));
  });
}

export interface StoredCommit {
  readonly commit: RepositoryCommit;
  readonly environmentId: string;
  readonly key: string;
  readonly repositoryId: string;
  readonly topologicalOrder?: number;
}

export interface StoredRepository {
  readonly cachedPage?: {
    readonly oids: readonly string[];
    readonly order: RepositoryHistoryQuery["order"];
    readonly requestedLimit: number;
    readonly rootOids: readonly string[];
  };
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly environmentId: string;
  readonly key: string;
  readonly objectFormat: "sha1" | "sha256";
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly repositoryId: string;
}
