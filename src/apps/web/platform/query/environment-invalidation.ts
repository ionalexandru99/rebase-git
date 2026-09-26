import type { RepositoryChangeKind } from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { EnvironmentChanges } from "#web/platform/environment/environment-protocol.contract";
import type { EnvironmentQueryMeta } from "#web/platform/query/environment-query-meta";

export function useEnvironmentInvalidation(
  changes: EnvironmentChanges,
  connected: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      changes.subscribe((repositoryIds, kind) => {
        void queryClient.invalidateQueries({
          predicate: (query) =>
            invalidatedByChange(query.meta, repositoryIds, kind),
        });
      }),
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
