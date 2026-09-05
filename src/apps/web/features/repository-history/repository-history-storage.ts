import {
  commitKey,
  commitStoreName,
  emptyStoredRepository,
  repositoryCommitRange,
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
const encoder = new TextEncoder();

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
        estimatedBytes += encoder.encode(JSON.stringify(commit)).byteLength;
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
    record.progress !== null &&
    typeof record.progress === "object" &&
    Number.isSafeInteger(record.progress.committedCommitCount) &&
    record.progress.committedCommitCount >= 0 &&
    Number.isSafeInteger(record.progress.nextBatchSequence) &&
    record.progress.nextBatchSequence >= 0 &&
    (record.completion === undefined ||
      (record.completion !== null &&
        typeof record.completion === "object" &&
        Number.isSafeInteger(record.completion.commitCount) &&
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
  isOpen?: (key: string) => boolean,
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
    if (isOpen?.(key)) {
      await completed;
      return false;
    }
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
    return true;
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
  await pruneUnreachableHistoryCommits(record, reachable, isOpen, indexedDB);
}

async function pruneUnreachableHistoryCommits(
  record: StoredRepository,
  reachable: ReadonlySet<string>,
  isOpen: (key: string) => boolean,
  indexedDB: IDBFactory,
) {
  let after: string | undefined;
  let commitCount: number | undefined;
  while (!isOpen(record.key)) {
    const lastKey = await withRepositoryHistoryDatabase(
      indexedDB,
      async (database) => {
        const transaction = database.transaction(
          [commitStoreName, repositoryStoreName],
          "readwrite",
        );
        const completed = transactionCompleted(transaction);
        const commits = transaction.objectStore(commitStoreName);
        const repositories = transaction.objectStore(repositoryStoreName);
        const records = await requestResult<StoredCommit[]>(
          commits.getAll(repositoryCommitRange(record.key, after), batchSize),
        );
        const current = await requestResult<StoredRepository | undefined>(
          repositories.get(record.key),
        );
        if (
          isOpen(record.key) ||
          current?.completion === undefined ||
          current.pendingSnapshot !== undefined
        ) {
          await completed;
          return undefined;
        }
        const unreachable = records.filter(
          (commit) => !reachable.has(commit.commit.oid),
        );
        if (unreachable.length > 0) {
          commitCount ??= await requestResult(
            commits.count(repositoryCommitRange(record.key)),
          );
          if (isOpen(record.key)) {
            await completed;
            return undefined;
          }
          commitCount -= unreachable.length;
          for (const commit of unreachable) commits.delete(commit.key);
          const {
            cachedPage: _,
            foregroundPages: _foregroundPages,
            ...withoutPage
          } = current;
          repositories.put({
            ...withoutPage,
            completion: { ...current.completion, commitCount },
            progress: {
              ...current.progress,
              committedCommitCount: commitCount,
            },
          } satisfies StoredRepository);
        }
        await completed;
        return records.length === batchSize ? records.at(-1)?.key : undefined;
      },
    );
    if (lastKey === undefined) return;
    after = lastKey;
  }
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
  visit: (commit: StoredCommit) => void,
  indexedDB: IDBFactory,
) {
  let after: string | undefined;
  for (;;) {
    const lastKey = await withRepositoryHistoryDatabase(
      indexedDB,
      async (database) => {
        const transaction = database.transaction(commitStoreName, "readonly");
        const completed = transactionCompleted(transaction);
        const store = transaction.objectStore(commitStoreName);
        const records = await requestResult<StoredCommit[]>(
          store.getAll(repositoryCommitRange(record.key, after), batchSize),
        );
        for (const commit of records) visit(commit);
        await completed;
        return records.length === batchSize ? records.at(-1)?.key : undefined;
      },
    );
    if (lastKey === undefined) return;
    after = lastKey;
  }
}
