import type { RepositoryChangeKind } from "@rebase/contracts";
import {
  type Query,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";
import type { EnvironmentQueryMeta } from "#web/platform/query/environment-query-meta";

export function useEnvironmentInvalidation(
  changes: EnvironmentChanges,
  connected: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(
    () => subscribeChangeInvalidation(queryClient, changes),
    [changes, queryClient],
  );
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current)
      void queryClient.invalidateQueries({
        predicate: (query) => invalidatedByChange(query.meta),
      });
    wasConnected.current = connected;
  }, [connected, queryClient]);
}

export function subscribeChangeInvalidation(
  queryClient: QueryClient,
  changes: EnvironmentChanges,
) {
  const cache = queryClient.getQueryCache();
  const changedWhileFetching = new WeakSet<Query>();
  const refetchAfterSettle = cache.subscribe(({ query }) => {
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
  const invalidateChanged = changes.subscribe((repositoryIds, kind) => {
    const predicate = (query: Query) =>
      invalidatedByChange(query.meta, repositoryIds, kind);
    for (const query of cache.findAll({ predicate, fetchStatus: "fetching" }))
      changedWhileFetching.add(query);
    void queryClient.invalidateQueries({ predicate }, { cancelRefetch: false });
  });
  return () => {
    invalidateChanged();
    refetchAfterSettle();
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
