import type { HistoryOrderCache } from "#web/features/repository-history/query/history-order.contract";
import { readRepositoryHistory } from "#web/features/repository-history/query/repository-history-query";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export async function readCurrentRepositoryHistory(
  environmentId: string,
  repositoryId: string,
  query: RepositoryHistoryQuery,
  cache: HistoryOrderCache,
  isCurrent: () => boolean,
) {
  while (isCurrent()) {
    const revision = cache.revision;
    const result = await readRepositoryHistory(
      environmentId,
      repositoryId,
      query,
      globalThis.indexedDB,
      cache,
    );
    if (!isCurrent()) return undefined;
    if (cache.revision === revision) return result;
  }
  return undefined;
}
