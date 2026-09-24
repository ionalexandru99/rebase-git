import type { RepositoryHistoryCacheDiagnostics } from "#web/domain/repository-history/history-storage.contract";
import type { StoredRepository } from "#web/persistence/repository-history/repository-history-database.contract";
import {
  emptyStoredRepository,
  repositoryKey,
} from "#web/persistence/repository-history/repository-history-records";
import {
  updateStoredHistory,
  updateStoredRepository,
} from "#web/persistence/repository-history/repository-history-transactions";

export function describeHistoryCaches(
  records: readonly StoredRepository[],
  isOpen: (key: string) => boolean,
  usageBytes: number | undefined,
): RepositoryHistoryCacheDiagnostics[] {
  const totalCommits = records.reduce(
    (total, record) => total + record.commitCount,
    0,
  );
  return records.map((record) => ({
    environmentId: record.environmentId,
    repositoryId: record.repositoryId,
    commitCount: record.commitCount,
    ...(usageBytes === undefined || totalCommits === 0
      ? {}
      : {
          estimatedBytes: Math.round(
            (usageBytes * record.commitCount) / totalCommits,
          ),
        }),
    lastOpenedAt: record.lastOpenedAt,
    open: isOpen(repositoryKey(record.environmentId, record.repositoryId)),
    state:
      record.completion !== undefined
        ? "complete"
        : record.commitCount === 0
          ? "empty"
          : "partial",
  }));
}

export function markHistoryCacheOpened(
  environmentId: string,
  repositoryId: string,
  indexedDB = globalThis.indexedDB,
) {
  return updateStoredRepository(indexedDB, async (transaction) => {
    const { completed } = transaction;
    const record = await transaction.readRepository(
      environmentId,
      repositoryId,
    );
    if (record !== undefined)
      await transaction.storeRepository({
        ...record,
        lastOpenedAt: Date.now(),
      });
    await completed;
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
    const record = await transaction.readRepository(
      environmentId,
      repositoryId,
    );
    if (isOpen?.(repositoryKey(environmentId, repositoryId))) {
      await completed;
      return false;
    }
    if (record !== undefined) {
      transaction.deleteRepositoryCommits(record.id);
      if (remove) transaction.deleteRepository(record.id);
      else
        await transaction.storeRepository({
          ...emptyStoredRepository(
            environmentId,
            repositoryId,
            record.objectFormat,
          ),
          id: record.id,
          lastOpenedAt: record.lastOpenedAt,
        });
    }
    await completed;
    return true;
  });
}
