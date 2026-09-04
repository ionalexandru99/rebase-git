import { RepositoryHistoryStorageUnavailable } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistoryCacheDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";

export function historyCacheCleanupCandidates<
  T extends Pick<
    RepositoryHistoryCacheDiagnostics,
    "environmentId" | "repositoryId" | "lastOpenedAt" | "open" | "state"
  >,
>(caches: readonly T[]) {
  return caches
    .filter((cache) => !cache.open && cache.state === "complete")
    .sort(
      (left, right) =>
        (left.lastOpenedAt ?? 0) - (right.lastOpenedAt ?? 0) ||
        left.environmentId.localeCompare(right.environmentId) ||
        left.repositoryId.localeCompare(right.repositoryId),
    );
}

export function isHistoryStorageQuotaError(error: unknown): boolean {
  if (error instanceof RepositoryHistoryStorageUnavailable) {
    return isHistoryStorageQuotaError(error.cause);
  }
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export async function writeHistoryWithCleanup<T>(options: {
  readonly write: () => Promise<T>;
  readonly prune: () => Promise<void>;
  readonly evictNext: () => Promise<boolean>;
}): Promise<T> {
  try {
    return await options.write();
  } catch (error) {
    if (!isHistoryStorageQuotaError(error)) throw error;
  }
  await options.prune();
  for (;;) {
    try {
      return await options.write();
    } catch (error) {
      if (!isHistoryStorageQuotaError(error) || !(await options.evictNext()))
        throw error;
    }
  }
}
