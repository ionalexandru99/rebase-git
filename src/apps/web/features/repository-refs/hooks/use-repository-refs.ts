import type {
  EnvironmentRpcClient,
  RepositoryRefs,
  RepositoryRefsFailed,
} from "@rebase/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { repositoryRefsKey } from "#web/features/repository-refs/repository-refs-query";
import { hasEnvironmentCapability } from "#web/platform/environment/environment-capabilities";
import { readRepositoryRefs } from "#web/platform/environment/rpc/read-repository-refs";
import {
  type Environment,
  useEnvironment,
} from "#web/platform/query/environment-context";
import { hasLiveData } from "#web/platform/query/live-query-data";
import {
  describeFailure,
  type RequestFailure,
  requestFailure,
} from "#web/platform/query/request-failure";

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
  const environment = useEnvironment();
  const { environmentId, rpc } = environment;
  const refsRpc = servesRefs(environment) ? rpc : undefined;
  const queryClient = useQueryClient();
  const queryKey = repositoryRefsKey(environmentId, logicalRepositoryId);
  const query = useQuery<
    RepositoryRefs,
    RequestFailure<RepositoryRefsFailed["failure"]>,
    RepositoryRefs,
    ReturnType<typeof repositoryRefsKey>
  >({
    queryKey,
    queryFn: ({ signal }) => readRefs(refsRpc, repositoryId, signal),
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
    restored: query.dataUpdatedAt > 0 && !hasLiveData(queryClient, queryKey),
    loading:
      query.data === undefined && !query.isError && repositoryId !== undefined,
    error: query.isError ? describeFailure(query.error) : null,
    retry,
  };
}

function readRefs(
  rpc: EnvironmentRpcClient | undefined,
  repositoryId: string | undefined,
  signal: AbortSignal,
) {
  if (rpc === undefined || repositoryId === undefined)
    return Promise.reject({ _tag: "Unanswered" });
  return readRepositoryRefs(rpc, repositoryId, signal).catch((error) => {
    throw requestFailure(error);
  });
}

function servesRefs(environment: Environment) {
  return (
    hasEnvironmentCapability(environment, "json-fragmentation") &&
    hasEnvironmentCapability(environment, "repository-refs")
  );
}
