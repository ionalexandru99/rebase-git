import type { RepositoryCatalogEntry, RepositoryRefs } from "@rebase/contracts";
import { useCallback, useEffect, useMemo } from "react";
import type { LocalEnvironmentSession } from "#web/app/environment/local-environment-session.contract";
import {
  createOpenedRepositoryStore,
  type OpenedRepositoryTarget,
  openedRepositoryKey,
} from "#web/app/shell/opened-repository";
import { useStore } from "#web/platform/store/use-store";

export function useOpenedRepository({
  environmentId,
  refs,
  repository,
  session,
  worktreePathFor,
}: {
  readonly environmentId: string | undefined;
  readonly refs: RepositoryRefs | undefined;
  readonly repository: RepositoryCatalogEntry | undefined;
  readonly session: LocalEnvironmentSession;
  readonly worktreePathFor: (repository: RepositoryCatalogEntry) => string;
}) {
  const store = useMemo(
    () => createOpenedRepositoryStore(session.repositoryHistory),
    [session.repositoryHistory],
  );
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
      const selected = session.repositoryCatalog
        .getSnapshot()
        .repositories.find(({ id }) => id === repositoryId);
      if (selected !== undefined && environmentId !== undefined)
        store.open(
          repositoryTarget(environmentId, selected, worktreePathFor(selected)),
        );
    },
    [environmentId, session.repositoryCatalog, store, worktreePathFor],
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
