import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { repositoryCatalogKey } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { useCommand } from "#web/platform/query/use-command";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

export function useRememberRepository() {
  return useCommand(RepositoryCatalogHttpApi.remember, {
    onSuccess: useCatalogRefresh(),
  });
}

export function useRecordRepositoryOpened() {
  return useCommand(RepositoryCatalogHttpApi.recordOpened, {
    onSuccess: useCatalogRefresh(),
  });
}

export function useRemoveRepository() {
  return useCommand(RepositoryCatalogHttpApi.remove, {
    onSuccess: useCatalogRefresh(),
  });
}

function useCatalogRefresh() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: repositoryCatalogKey(environmentId),
      }),
    [environmentId, queryClient],
  );
}
