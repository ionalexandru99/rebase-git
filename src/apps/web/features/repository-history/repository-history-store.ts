import type {
  RepositoryCommit,
  RepositoryHistoryBatch,
  RepositoryHistoryPage,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
  type RepositoryHistoryCompletionBasis,
  type RepositoryHistorySynchronizationProgress,
} from "#web/features/repository-history/repository-history-completion";
import {
  commitKey,
  commitStoreName,
  emptyStoredRepository,
  repositoryKey,
  repositoryOrderIndexName,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  storedCommit,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export interface StoredRepositoryHistoryState {
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly progress: RepositoryHistorySynchronizationProgress;
}

export function storeRepositoryHistoryPage(
  environmentId: string,
  repositoryId: string,
  page: RepositoryHistoryPage,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    const existingCommits = await Promise.all(
      page.commits.map((commit) =>
        requestResult<StoredCommit | undefined>(
          commits.get(commitKey(environmentId, repositoryId, commit.oid)),
        ),
      ),
    );
    for (const [index, commit] of page.commits.entries()) {
      commits.put(
        storedCommit(
          environmentId,
          repositoryId,
          commit,
          existingCommits[index]?.topologicalOrder,
        ),
      );
    }
    const { completion: _, ...currentWithoutCompletion } =
      current ??
      emptyStoredRepository(environmentId, repositoryId, page.objectFormat);
    repositories.put({
      ...emptyStoredRepository(environmentId, repositoryId, page.objectFormat),
      ...currentWithoutCompletion,
      cachedPage: {
        oids: page.commits.map((commit) => commit.oid),
        order: query.order,
        requestedLimit: query.limit,
        rootOids: normalizedOids(page.refTargets.map((ref) => ref.oid)),
      },
      objectFormat: page.objectFormat,
      refTargets: page.refTargets,
    } satisfies StoredRepository);
    await completed;
  });
}

export function beginRepositoryHistorySynchronization(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no initial page");
    }
    const { completion: _, ...incomplete } = current;
    repositories.put({
      ...incomplete,
      progress: { committedCommitCount: 0, nextBatchSequence: 0 },
    } satisfies StoredRepository);
    await completed;
  });
}

export function storeRepositoryHistoryBatch(
  environmentId: string,
  repositoryId: string,
  batch: RepositoryHistoryBatch,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const progress = acceptRepositoryHistoryBatch(
      current.progress,
      batch.sequence,
      batch.commits.length,
    );
    if (progress !== current.progress) {
      const start = current.progress.committedCommitCount;
      for (const [offset, commit] of batch.commits.entries()) {
        commits.put(
          storedCommit(environmentId, repositoryId, commit, start + offset),
        );
      }
      repositories.put({
        ...current,
        objectFormat: batch.objectFormat,
        progress,
      } satisfies StoredRepository);
    }
    await completed;
    return progress.committedCommitCount;
  });
}

export function completeStoredRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  reportedCommitCount: number,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    if (current === undefined) {
      throw new Error("Repository history has no synchronization state");
    }
    const completion = completeRepositoryHistory(
      current.progress,
      reportedCommitCount,
    );
    repositories.put({ ...current, completion } satisfies StoredRepository);
    await completed;
    return completion;
  });
}

export function readStoredRepositoryHistoryState(
  environmentId: string,
  repositoryId: string,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
): Promise<StoredRepositoryHistoryState | undefined> {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const repository = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    await completed;
    if (repository === undefined) {
      return undefined;
    }
    return {
      ...(repository.completion === undefined
        ? {}
        : { completion: repository.completion }),
      objectFormat: repository.objectFormat,
      progress: repository.progress,
      refTargets: repository.refTargets,
    };
  });
}

export function readRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
): Promise<readonly RepositoryCommit[] | undefined> {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [commitStoreName, repositoryStoreName],
      "readonly",
    );
    const completed = transactionCompleted(transaction);
    const commits = transaction.objectStore(commitStoreName);
    const repository = await requestResult<StoredRepository | undefined>(
      transaction
        .objectStore(repositoryStoreName)
        .get(repositoryKey(environmentId, repositoryId)),
    );
    if (repository?.completion === undefined) {
      await completed;
      return undefined;
    }
    const roots = normalizedOids(query.roots.map((root) => root.oid));
    const storedRoots = await Promise.all(
      roots.map((oid) =>
        requestResult<StoredCommit | undefined>(
          commits.get(commitKey(environmentId, repositoryId, oid)),
        ),
      ),
    );
    if (storedRoots.some((root) => root === undefined)) {
      await completed;
      return undefined;
    }
    if (
      query.order === repository.cachedPage?.order &&
      sameOids(roots, repository.cachedPage.rootOids) &&
      (query.limit <= repository.cachedPage.oids.length ||
        repository.cachedPage.oids.length <
          repository.cachedPage.requestedLimit)
    ) {
      const cachedOids = repository.cachedPage.oids.slice(0, query.limit);
      const result = await readCommitsByOid(
        commits,
        environmentId,
        repositoryId,
        cachedOids,
      );
      if (result.length !== cachedOids.length) {
        throw new Error("Repository history cache is incomplete");
      }
      await completed;
      return result;
    }
    const result = await readTopologicalHistory(
      commits.index(repositoryOrderIndexName),
      environmentId,
      repositoryId,
      roots,
      query.limit,
    );
    await completed;
    return result;
  });
}

export function storeRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  commits: readonly RepositoryCommit[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(commitStoreName);
    for (const commit of commits) {
      store.put(storedCommit(environmentId, repositoryId, commit));
    }
    await completed;
  });
}

export function readRepositoryCommits(
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
  indexedDB: IDBFactory | undefined = globalThis.indexedDB,
) {
  if (oids.length > 1_000) {
    return Promise.reject(new Error("Query is too large"));
  }
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const records = await readCommitsByOid(
      transaction.objectStore(commitStoreName),
      environmentId,
      repositoryId,
      oids,
    );
    await completed;
    return records;
  });
}

function readCommitsByOid(
  store: IDBObjectStore,
  environmentId: string,
  repositoryId: string,
  oids: readonly string[],
) {
  return Promise.all(
    oids.map((oid) =>
      requestResult<StoredCommit | undefined>(
        store.get(commitKey(environmentId, repositoryId, oid)),
      ),
    ),
  ).then((records) =>
    records.flatMap((record) => (record === undefined ? [] : [record.commit])),
  );
}

function readTopologicalHistory(
  index: IDBIndex,
  environmentId: string,
  repositoryId: string,
  roots: readonly string[],
  limit: number,
) {
  const range = IDBKeyRange.bound(
    [environmentId, repositoryId, 0],
    [environmentId, repositoryId, Number.MAX_SAFE_INTEGER],
  );
  const reachable = new Set(roots);
  return new Promise<readonly RepositoryCommit[]>((resolve, reject) => {
    const result: RepositoryCommit[] = [];
    const request = index.openCursor(range);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB cursor failed"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null || result.length === limit) {
        resolve(result);
        return;
      }
      const record = cursor.value as StoredCommit;
      if (reachable.delete(record.commit.oid)) {
        result.push(record.commit);
        for (const parent of record.commit.parents) {
          reachable.add(parent);
        }
      }
      cursor.continue();
    };
  });
}

function normalizedOids(oids: readonly string[]) {
  return [...new Set(oids)].sort();
}

function sameOids(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}
