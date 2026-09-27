import {
  clearRepository,
  HistoryStorageUnavailable,
  readRepositories,
  type StoredRepository,
} from "#web/features/repository-history/history-database";
import type {
  HistoryCache,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol";

type IsOpen = (environmentId: string, repositoryId: string) => boolean;

export async function describeHistoryStorage(
  isOpen: IsOpen,
): Promise<HistoryStorage> {
  const [records, estimate, persistent] = await Promise.all([
    readRepositories(),
    navigator.storage?.estimate().catch((): StorageEstimate => ({})),
    navigator.storage?.persisted().catch(() => false),
  ]);
  const usage = estimate?.usage;
  const totalCommits = records.reduce(
    (total, record) => total + record.commitCount,
    0,
  );
  return {
    caches: records.map((record) => ({
      environmentId: record.environmentId,
      repositoryId: record.repositoryId,
      commitCount: record.commitCount,
      ...(usage === undefined || totalCommits === 0
        ? {}
        : {
            estimatedBytes: Math.round(
              (usage * record.commitCount) / totalCommits,
            ),
          }),
      lastOpenedAt: record.lastOpenedAt,
      open: isOpen(record.environmentId, record.repositoryId),
      state: cacheState(record),
    })),
    persistent: persistent ?? false,
    ...(usage === undefined ? {} : { usageBytes: usage }),
    ...(estimate?.quota === undefined ? {} : { quotaBytes: estimate.quota }),
  };
}

export async function writeWithEviction<T>(
  write: () => Promise<T>,
  isOpen: IsOpen,
): Promise<T> {
  const attempted = new Set<string>();
  for (;;) {
    try {
      return await write();
    } catch (error) {
      if (
        !(error instanceof HistoryStorageUnavailable) ||
        !error.quotaExceeded ||
        !(await evictOldestCache(isOpen, attempted))
      )
        throw error;
    }
  }
}

async function evictOldestCache(isOpen: IsOpen, attempted: Set<string>) {
  const candidates = (await readRepositories())
    .filter(
      (record) =>
        !attempted.has(`${record.environmentId}\0${record.repositoryId}`) &&
        !isOpen(record.environmentId, record.repositoryId) &&
        cacheState(record) === "complete",
    )
    .sort(
      (left, right) =>
        left.lastOpenedAt - right.lastOpenedAt ||
        left.environmentId.localeCompare(right.environmentId) ||
        left.repositoryId.localeCompare(right.repositoryId),
    );
  for (const candidate of candidates) {
    attempted.add(`${candidate.environmentId}\0${candidate.repositoryId}`);
    try {
      await clearRepository(
        candidate.environmentId,
        candidate.repositoryId,
        true,
      );
      return true;
    } catch {}
  }
  return false;
}

function cacheState(record: StoredRepository): HistoryCache["state"] {
  return record.tips !== undefined
    ? "complete"
    : record.commitCount === 0
      ? "empty"
      : "partial";
}
