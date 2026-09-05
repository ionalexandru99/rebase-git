import type { RepositoryHistoryCacheDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";
import {
  readHistoryCacheRecords,
  visitHistoryCacheCommits,
} from "#web/persistence/repository-history/repository-history-cache-records";
import type { StoredRepository } from "#web/persistence/repository-history/repository-history-database.contract";
import {
  emptyStoredRepository,
  repositoryKey,
} from "#web/persistence/repository-history/repository-history-records";
import {
  readStoredCommits,
  updateStoredHistory,
  updateStoredRepository,
} from "#web/persistence/repository-history/repository-history-transactions";

const batchSize = 256;
const encoder = new TextEncoder();

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
      record.key,
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
  return updateStoredRepository(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const record = await transaction.readRepository(
      repositoryKey(environmentId, repositoryId),
    );
    if (record !== undefined && isCompatibleHistoryCache(record)) {
      transaction.storeRepository({
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
  return updateStoredHistory(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const key = repositoryKey(environmentId, repositoryId);
    const record = await transaction.readRepository(key);
    if (isOpen?.(key)) {
      await completed;
      return false;
    }
    transaction.deleteRepositoryCommits(key);
    if (remove || record === undefined) {
      transaction.deleteRepository(key);
    } else {
      transaction.storeRepository({
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
    const commits = await readStoredCommits(
      record.environmentId,
      record.repositoryId,
      oids,
      indexedDB,
    );
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
    const lastKey = await updateStoredHistory(
      indexedDB,
      async (transaction) => {
        const { completed } = transaction;
        const records = await transaction.readCommitChunk(
          record.key,
          after,
          batchSize,
        );
        const current = await transaction.readRepository(record.key);
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
          commitCount ??= await transaction.countCommits(record.key);
          if (isOpen(record.key)) {
            await completed;
            return undefined;
          }
          commitCount -= unreachable.length;
          for (const commit of unreachable)
            transaction.deleteCommit(commit.key);
          const {
            cachedPage: _,
            foregroundPages: _foregroundPages,
            ...withoutPage
          } = current;
          transaction.storeRepository({
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
