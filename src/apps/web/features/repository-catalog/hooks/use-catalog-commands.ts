import {
  type RepositoryCatalog,
  type RepositoryCatalogEntry,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  repositoryCatalogKey,
  sortRepositories,
} from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { useEnvironment } from "#web/platform/query/environment-context";
import { useCommand } from "#web/platform/query/use-command";

type CatalogChange = (
  repositories: readonly RepositoryCatalogEntry[],
) => readonly RepositoryCatalogEntry[];

export function useRememberRepository() {
  const writeCatalog = useCatalogWrite();
  return useCommand(RepositoryCatalogHttpApi.remember, {
    onSuccess: (entry) => writeCatalog(replaceRepository(entry)),
  });
}

export function useRecordRepositoryOpened() {
  const writeCatalog = useCatalogWrite();
  return useCommand(RepositoryCatalogHttpApi.recordOpened, {
    onSuccess: (entry) => writeCatalog(replaceRepository(entry)),
  });
}

export function useRemoveRepository() {
  const writeCatalog = useCatalogWrite();
  return useCommand(RepositoryCatalogHttpApi.remove, {
    onSuccess: ({ repositoryId }) =>
      writeCatalog((repositories) =>
        repositories.filter(({ id }) => id !== repositoryId),
      ),
  });
}

function useCatalogWrite() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  return useCallback(
    async (change: CatalogChange) => {
      const queryKey = repositoryCatalogKey(environmentId);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<RepositoryCatalog>(queryKey, (catalog) => ({
        repositories: change(catalog?.repositories ?? []),
      }));
      void queryClient.invalidateQueries({ queryKey });
    },
    [environmentId, queryClient],
  );
}

function replaceRepository(entry: RepositoryCatalogEntry): CatalogChange {
  return (repositories) =>
    sortRepositories([
      ...repositories.filter(({ id }) => id !== entry.id),
      entry,
    ]);
}
