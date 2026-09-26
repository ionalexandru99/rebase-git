import type { QueryClient } from "@tanstack/react-query";

const repositoryRefsRoot = "repository-refs";

export function repositoryRefsKey(
  environmentId: string | undefined,
  logicalRepositoryId: string | undefined,
) {
  return [
    repositoryRefsRoot,
    environmentId ?? null,
    logicalRepositoryId ?? null,
  ] as const;
}

export function forgetRepositoryRefs(
  queryClient: QueryClient,
  environmentId: string,
  logicalRepositoryId: string,
) {
  queryClient.removeQueries({
    queryKey: repositoryRefsKey(environmentId, logicalRepositoryId),
    type: "inactive",
  });
}

export function forgetAllRepositoryRefs(queryClient: QueryClient) {
  queryClient.removeQueries({
    queryKey: [repositoryRefsRoot],
    type: "inactive",
  });
}
