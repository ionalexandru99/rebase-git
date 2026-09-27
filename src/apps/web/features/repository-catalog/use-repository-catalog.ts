import {
  type RepositoryCatalog,
  RepositoryCatalogApi,
  type RepositoryCatalogEntry,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useEnvironment } from "#web/platform/query/environment-context";
import {
  environmentQueryKey,
  useEnvironmentQuery,
} from "#web/platform/query/environment-query";
import { answer } from "#web/platform/query/use-command";

const noRepositories: readonly RepositoryCatalogEntry[] = [];

export function repositoryCatalogKey(environmentId: string | undefined) {
  return environmentQueryKey(
    environmentId,
    null,
    RepositoryCatalogApi.list,
    undefined,
  );
}

function sortRepositories(repositories: readonly RepositoryCatalogEntry[]) {
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
  const catalog = useEnvironmentQuery(RepositoryCatalogApi.list, undefined, {
    changes: "none",
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    select: sortCatalog,
  });
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

export function catalogWith(entry: RepositoryCatalogEntry) {
  return [
    answer(
      RepositoryCatalogApi.list,
      undefined,
      (catalog): RepositoryCatalog => ({
        repositories: [...without(catalog, entry.id), entry],
      }),
    ),
  ];
}

export function catalogWithout({
  repositoryId,
}: {
  readonly repositoryId: string;
}) {
  return [
    answer(
      RepositoryCatalogApi.list,
      undefined,
      (catalog): RepositoryCatalog => ({
        repositories: without(catalog, repositoryId),
      }),
    ),
  ];
}

function without(catalog: RepositoryCatalog | undefined, repositoryId: string) {
  return (catalog?.repositories ?? []).filter(({ id }) => id !== repositoryId);
}

export function useCatalogRepository(repositoryId: string | undefined) {
  const { repositories } = useRepositoryCatalog();
  return repositories.find(({ id }) => id === repositoryId);
}
