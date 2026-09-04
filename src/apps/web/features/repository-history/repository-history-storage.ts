import {
  commitKey,
  commitStoreName,
  emptyStoredRepository,
  repositoryKey,
  repositoryStoreName,
  requestResult,
  type StoredCommit,
  type StoredRepository,
  transactionCompleted,
  withRepositoryHistoryDatabase,
} from "#web/features/repository-history/repository-history-database";
import type { RepositoryHistoryCacheDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

const batchSize = 256;

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

export async function describeHistoryCaches(
  isOpen: (key: string) => boolean,
  indexedDB = globalThis.indexedDB,
): Promise<RepositoryHistoryCacheDiagnostics[]> {
  const records = await readHistoryCacheRecords(indexedDB);
  const diagnostics: RepositoryHistoryCacheDiagnostics[] = [];
  for (const record of records) {
    let commitCount = 0;
    let estimatedBytes = 0;
    await visitHistoryCacheCommits(
      record,
      (commit) => {
        commitCount += 1;
        estimatedBytes += new TextEncoder().encode(
          JSON.stringify(commit),
        ).byteLength;
      },
      indexedDB,
    );
    diagnostics.push({
      environmentId: record.environmentId,
      repositoryId: record.repositoryId,
      commitCount,
      estimatedBytes,
      lastOpenedAt: record.lastOpenedAt,
      open: isOpen(record.key),
      state: !isCompatibleHistoryCache(record)
        ? "incompatible"
        : record.completion !== undefined
          ? "complete"
          : commitCount === 0
            ? "empty"
            : "partial",
    });
  }
  return diagnostics;
}

export function isCompatibleHistoryCache(record: StoredRepository) {
  return (
    (record.cacheFormatVersion ?? 1) === 1 &&
    (record.objectFormat === "sha1" || record.objectFormat === "sha256") &&
    Array.isArray(record.refTargets) &&
    record.refTargets.every(
      (ref) => typeof ref?.oid === "string" && typeof ref?.name === "string",
    ) &&
    record.progress !== undefined &&
    Number.isSafeInteger(record.progress.committedCommitCount) &&
    record.progress.committedCommitCount >= 0 &&
    Number.isSafeInteger(record.progress.nextBatchSequence) &&
    record.progress.nextBatchSequence >= 0 &&
    (record.completion === undefined ||
      (Number.isSafeInteger(record.completion.commitCount) &&
        record.completion.commitCount >= 0))
  );
}

export function markHistoryCacheOpened(
  environmentId: string,
  repositoryId: string,
  indexedDB = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(repositoryStoreName);
    const record = await requestResult<StoredRepository | undefined>(
      store.get(repositoryKey(environmentId, repositoryId)),
    );
    if (record !== undefined && isCompatibleHistoryCache(record)) {
      store.put({
        ...record,
        lastOpenedAt: Date.now(),
      } satisfies StoredRepository);
    }
    await completed;
    return record === undefined || isCompatibleHistoryCache(record);
  });
}

export function clearHistoryCache(
  environmentId: string,
  repositoryId: string,
  remove: boolean,
  indexedDB = globalThis.indexedDB,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(
      [repositoryStoreName, commitStoreName],
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const key = repositoryKey(environmentId, repositoryId);
    const record = await requestResult<StoredRepository | undefined>(
      repositories.get(key),
    );
    transaction.objectStore(commitStoreName).delete(repositoryCommitRange(key));
    if (remove || record === undefined) {
      repositories.delete(key);
    } else {
      repositories.put({
        ...emptyStoredRepository(
          environmentId,
          repositoryId,
          record.objectFormat === "sha256" ? "sha256" : "sha1",
        ),
        ...(record.lastOpenedAt === undefined
          ? {}
          : { lastOpenedAt: record.lastOpenedAt }),
      } satisfies StoredRepository);
    }
    await completed;
  });
}

export async function pruneHistoryCache(
  record: StoredRepository,
  isOpen: (key: string) => boolean,
  indexedDB = globalThis.indexedDB,
) {
  if (
    isOpen(record.key) ||
    record.completion === undefined ||
    record.pendingSnapshot !== undefined ||
    !isCompatibleHistoryCache(record)
  )
    return;
  const reachable = new Set<string>();
  const pending = [
    ...(record.completion.snapshot?.rootOids ??
      record.refTargets.map((ref) => ref.oid)),
  ];
  while (pending.length > 0) {
    if (isOpen(record.key)) return;
    const oids = pending
      .splice(-batchSize)
      .filter((oid) => !reachable.has(oid));
    for (const oid of oids) reachable.add(oid);
    const commits = await readReachableBatch(record, oids, indexedDB);
    for (const commit of commits) {
      if (commit !== undefined)
        pending.push(
          ...commit.commit.parents.filter((oid) => !reachable.has(oid)),
        );
    }
  }
  let removed = false;
  await visitHistoryCacheCommits(
    record,
    (commit, store) => {
      if (!isOpen(record.key) && !reachable.has(commit.commit.oid)) {
        store.delete(commit.key);
        removed = true;
      }
    },
    indexedDB,
    "readwrite",
  );
  if (removed) await forgetCachedHistoryPage(record, indexedDB);
}

function forgetCachedHistoryPage(
  record: StoredRepository,
  indexedDB: IDBFactory,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(repositoryStoreName, "readwrite");
    const completed = transactionCompleted(transaction);
    const repositories = transaction.objectStore(repositoryStoreName);
    const current = await requestResult<StoredRepository | undefined>(
      repositories.get(record.key),
    );
    if (current !== undefined) {
      const { cachedPage: _, ...withoutPage } = current;
      repositories.put(withoutPage);
    }
    await completed;
  });
}

function readReachableBatch(
  record: StoredRepository,
  oids: readonly string[],
  indexedDB: IDBFactory,
) {
  return withRepositoryHistoryDatabase(indexedDB, async (database) => {
    const transaction = database.transaction(commitStoreName, "readonly");
    const completed = transactionCompleted(transaction);
    const store = transaction.objectStore(commitStoreName);
    const commits = await Promise.all(
      oids.map((oid) =>
        requestResult<StoredCommit | undefined>(
          store.get(commitKey(record.environmentId, record.repositoryId, oid)),
        ),
      ),
    );
    await completed;
    return commits;
  });
}

async function visitHistoryCacheCommits(
  record: StoredRepository,
  visit: (commit: StoredCommit, store: IDBObjectStore) => void,
  indexedDB: IDBFactory,
  mode: IDBTransactionMode = "readonly",
) {
  let after: string | undefined;
  for (;;) {
    const lastKey = await withRepositoryHistoryDatabase(
      indexedDB,
      async (database) => {
        const transaction = database.transaction(commitStoreName, mode);
        const completed = transactionCompleted(transaction);
        const store = transaction.objectStore(commitStoreName);
        const records = await requestResult<StoredCommit[]>(
          store.getAll(repositoryCommitRange(record.key, after), batchSize),
        );
        for (const commit of records) visit(commit, store);
        await completed;
        return records.length === batchSize ? records.at(-1)?.key : undefined;
      },
    );
    if (lastKey === undefined) return;
    after = lastKey;
  }
}

function repositoryCommitRange(key: string, after?: string) {
  return IDBKeyRange.bound(
    after ?? `${key}\0`,
    `${key}\0\uffff`,
    after !== undefined,
  );
}
