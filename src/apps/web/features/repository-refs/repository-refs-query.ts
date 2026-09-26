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
  forget(queryClient, repositoryRefsKey(environmentId, logicalRepositoryId));
}

export function forgetAllRepositoryRefs(queryClient: QueryClient) {
  forget(queryClient, [repositoryRefsRoot]);
}

function forget(queryClient: QueryClient, queryKey: readonly unknown[]) {
  queryClient.removeQueries({ queryKey, type: "inactive" });
  void queryClient.resetQueries({ queryKey });
}
