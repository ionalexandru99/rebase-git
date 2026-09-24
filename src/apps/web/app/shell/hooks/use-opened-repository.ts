import type { RepositoryCatalogEntry } from "@rebase/contracts";
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
  repository,
  session,
  worktreePathFor,
}: {
  readonly environmentId: string | undefined;
  readonly repository: RepositoryCatalogEntry | undefined;
  readonly session: LocalEnvironmentSession;
  readonly worktreePathFor: (repository: RepositoryCatalogEntry) => string;
}) {
  const store = useMemo(
    () =>
      createOpenedRepositoryStore({
        history: session.repositoryHistory,
        refs: session.repositoryRefs,
      }),
    [session.repositoryHistory, session.repositoryRefs],
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

  const open = useCallback(
    (repositoryId: string) => {
      session.repositoryRefs.select(repositoryId);
      const selected = session.repositoryCatalog
        .getSnapshot()
        .repositories.find(({ id }) => id === repositoryId);
      if (selected !== undefined && environmentId !== undefined)
        store.open(
          repositoryTarget(environmentId, selected, worktreePathFor(selected)),
        );
    },
    [
      environmentId,
      session.repositoryCatalog,
      session.repositoryRefs,
      store,
      worktreePathFor,
    ],
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
