import {
  type RepositoryCatalog,
  type RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useEnvironment } from "#web/platform/query/environment-context";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";

const noRepositories: readonly RepositoryCatalogEntry[] = [];

export function repositoryCatalogKey(environmentId: string | undefined) {
  return environmentQueryKey(
    environmentId,
    null,
    RepositoryCatalogHttpApi.list,
    undefined,
  );
}

export function sortRepositories(
  repositories: readonly RepositoryCatalogEntry[],
) {
  return [...repositories].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.path.localeCompare(right.path),
  );
}

function sortCatalog(catalog: RepositoryCatalog): RepositoryCatalog {
  return { repositories: sortRepositories(catalog.repositories) };
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
      select: sortCatalog,
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
