import type { RepositoryCatalogEntry, RepositoryRefs } from "@rebase/contracts";
import { useCallback, useEffect, useMemo } from "react";
import {
  createOpenedRepositoryStore,
  type OpenedRepositoryTarget,
  openedRepositoryKey,
} from "#web/app/shell/opened-repository";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader.contract";
import { useStore } from "#web/platform/store/use-store";

export function useOpenedRepository({
  environmentId,
  findRepository,
  gateway,
  refs,
  repository,
  worktreePathFor,
}: {
  readonly environmentId: string | undefined;
  readonly findRepository: (
    repositoryId: string,
  ) => RepositoryCatalogEntry | undefined;
  readonly gateway: RepositoryHistoryGateway;
  readonly refs: RepositoryRefs | undefined;
  readonly repository: RepositoryCatalogEntry | undefined;
  readonly worktreePathFor: (repository: RepositoryCatalogEntry) => string;
}) {
  const store = useMemo(() => createOpenedRepositoryStore(gateway), [gateway]);
  useEffect(() => () => store.open(undefined), [store]);
  const opened = useStore(store);
  const worktreePath =
    repository === undefined ? "" : worktreePathFor(repository);
  const target = useMemo(
    () =>
      repository === undefined || environmentId === undefined
        ? undefined
        : repositoryTarget(environmentId, repository, worktreePath),
    [environmentId, repository, worktreePath],
  );
  useEffect(() => store.open(target), [store, target]);
  useEffect(() => {
    if (opened !== undefined && refs !== undefined) store.refsArrived(refs);
  }, [store, opened, refs]);

  const open = useCallback(
    (repositoryId: string) => {
      const selected = findRepository(repositoryId);
      if (selected !== undefined && environmentId !== undefined)
        store.open(
          repositoryTarget(environmentId, selected, worktreePathFor(selected)),
        );
    },
    [environmentId, findRepository, store, worktreePathFor],
  );

  return {
    history:
      target !== undefined && opened?.key === openedRepositoryKey(target)
        ? opened.history
        : undefined,
    open,
  };
}

function repositoryTarget(
  environmentId: string,
  repository: RepositoryCatalogEntry,
  worktreePath: string,
): OpenedRepositoryTarget {
  return {
    environmentId,
    repositoryId: repository.id,
    logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
    worktreePath,
  };
}
