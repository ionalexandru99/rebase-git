import type { RepositoryChangeKind } from "@rebase/contracts";
import type { Query, QueryClient } from "@tanstack/react-query";
import type { EnvironmentQueryMeta } from "#web/platform/query/environment-query-meta";

export interface EnvironmentInvalidation {
  readonly changed: (
    repositoryIds?: readonly string[],
    kind?: RepositoryChangeKind,
  ) => void;
}

export function createEnvironmentInvalidation(
  queryClient: QueryClient,
): EnvironmentInvalidation {
  const cache = queryClient.getQueryCache();
  const changedWhileFetching = new WeakSet<Query>();
  cache.subscribe(({ query }) => {
    if (
      query.state.fetchStatus === "fetching" ||
      !changedWhileFetching.delete(query)
    )
      return;
    void queryClient.invalidateQueries(
      { queryKey: query.queryKey, exact: true },
      { cancelRefetch: false },
    );
  });
  return {
    changed: (repositoryIds, kind) => {
      const predicate = (query: Query) =>
        invalidatedByChange(query.meta, repositoryIds, kind);
      for (const query of cache.findAll({ predicate, fetchStatus: "fetching" }))
        changedWhileFetching.add(query);
      void queryClient.invalidateQueries(
        { predicate },
        { cancelRefetch: false },
      );
    },
  };
}

export function invalidatedByChange(
  meta: EnvironmentQueryMeta | undefined,
  repositoryIds?: readonly string[],
  kind?: RepositoryChangeKind,
) {
  if (meta === undefined || meta.changes === "none") return false;
  if (kind === "Index" && meta.changes !== "index") return false;
  return (
    repositoryIds === undefined ||
    (meta.repositoryId !== null && repositoryIds.includes(meta.repositoryId))
  );
}
