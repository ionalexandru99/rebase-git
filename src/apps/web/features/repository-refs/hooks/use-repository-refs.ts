import type { EnvironmentRpcClient, RepositoryRefs } from "@rebase/contracts";
import { environmentResponseError } from "@rebase/environment-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { describeRefsReadFailure } from "#web/features/repository-refs/refs-messages";
import { repositoryRefsKey } from "#web/features/repository-refs/repository-refs-query";
import {
  type RepositoryRefsReadFailure,
  readRepositoryRefs,
} from "#web/platform/environment/rpc/read-repository-refs";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export interface RepositoryRefsRead {
  readonly refs: RepositoryRefs | undefined;
  readonly restored: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export function useRepositoryRefs(
  repositoryId: string | undefined,
  logicalRepositoryId: string | undefined,
): RepositoryRefsRead {
  const { environmentId, rpc } = useEnvironment();
  const query = useQuery<
    RepositoryRefs,
    RepositoryRefsReadFailure,
    RepositoryRefs,
    ReturnType<typeof repositoryRefsKey>
  >({
    queryKey: repositoryRefsKey(environmentId, logicalRepositoryId),
    queryFn: ({ signal }) => readRefs(rpc, repositoryId, signal),
    enabled:
      rpc !== undefined &&
      environmentId !== undefined &&
      repositoryId !== undefined &&
      logicalRepositoryId !== undefined,
    meta: {
      changes: "refs",
      repositoryId: repositoryId ?? null,
      persist: true,
    },
    gcTime: Number.POSITIVE_INFINITY,
    select: useCallback(
      (refs: RepositoryRefs) =>
        repositoryId === undefined || refs.repositoryId === repositoryId
          ? refs
          : { ...refs, repositoryId },
      [repositoryId],
    ),
  });
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return {
    refs: query.data,
    restored: query.data !== undefined && !query.isFetched,
    loading:
      query.data === undefined && !query.isError && repositoryId !== undefined,
    error: query.isError ? describeRefsReadFailure(query.error) : null,
    retry,
  };
}

function readRefs(
  rpc: EnvironmentRpcClient | undefined,
  repositoryId: string | undefined,
  signal: AbortSignal,
) {
  if (rpc === undefined || repositoryId === undefined)
    return Promise.reject(environmentResponseError("WebSocket"));
  return readRepositoryRefs(rpc, repositoryId, signal);
}
