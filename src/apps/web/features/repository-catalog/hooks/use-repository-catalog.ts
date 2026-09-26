import {
  type RepositoryCatalog,
  type RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

const noRepositories: readonly RepositoryCatalogEntry[] = [];

export function repositoryCatalogKey(environmentId: string | undefined) {
  return environmentQueryKey(
    environmentId,
    null,
    RepositoryCatalogHttpApi.list,
    undefined,
  );
}

export function useRepositoryCatalog() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  const catalog = useEnvironmentQuery(
    RepositoryCatalogHttpApi.list,
    undefined,
    {
      changes: "none",
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const findRepository = useCallback(
    (repositoryId: string) =>
      queryClient
        .getQueryData<RepositoryCatalog>(repositoryCatalogKey(environmentId))
        ?.repositories.find(({ id }) => id === repositoryId),
    [environmentId, queryClient],
  );
  return {
    repositories: catalog.data?.repositories ?? noRepositories,
    findRepository,
  };
}
