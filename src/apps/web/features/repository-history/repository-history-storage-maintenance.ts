import { repositoryKey } from "#web/features/repository-history/repository-history-database";
import {
  clearHistoryCache,
  pruneHistoryCache,
  readHistoryCacheRecords,
} from "#web/features/repository-history/repository-history-storage";
import {
  historyCacheCleanupCandidates,
  writeHistoryWithCleanup,
} from "#web/features/repository-history/repository-history-storage-policy";

let storageWrites: Promise<unknown> = Promise.resolve();

export function queueHistoryStorageWrite<T>(
  write: () => Promise<T>,
): Promise<T> {
  const result = storageWrites.then(write);
  storageWrites = result.catch(() => undefined);
  return result;
}

export function writeHistoryUnderPressure<T>(
  write: () => Promise<T>,
  isOpen: (key: string) => boolean,
) {
  return queueHistoryStorageWrite(async () => {
    const attempted = new Set<string>();
    return writeHistoryWithCleanup({
      write,
      prune: async () => {
        for (const record of await readHistoryCacheRecords()) {
          await pruneHistoryCache(record, isOpen).catch(() => undefined);
        }
      },
      evictNext: () => evictNextHistoryCache(isOpen, attempted),
    });
  });
}

async function evictNextHistoryCache(
  isOpen: (key: string) => boolean,
  attempted: Set<string>,
) {
  const candidates = historyCacheCleanupCandidates(
    (await readHistoryCacheRecords()).map((record) => ({
      environmentId: record.environmentId,
      repositoryId: record.repositoryId,
      lastOpenedAt: record.lastOpenedAt,
      open: isOpen(record.key) || attempted.has(record.key),
      state:
        record.completion === undefined || record.pendingSnapshot !== undefined
          ? "partial"
          : "complete",
    })),
  );
  for (const candidate of candidates) {
    const key = repositoryKey(candidate.environmentId, candidate.repositoryId);
    attempted.add(key);
    if (isOpen(key)) continue;
    try {
      await clearHistoryCache(
        candidate.environmentId,
        candidate.repositoryId,
        true,
      );
      return true;
    } catch {}
  }
  return false;
}
