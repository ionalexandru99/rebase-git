import type { RepositoryCatalogEntry, RepositoryRefs } from "@rebase/contracts";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { OpenedHistoryContext } from "#web/app/shell/opened-history-context";
import {
  type OpenedRepositoryStore,
  openedRepositoryKey,
  openedRepositoryTarget,
} from "#web/app/shell/opened-repository";
import {
  type Navigate,
  type Navigation,
  worktreePathFor,
} from "#web/app/shell/use-navigation";
import { useCatalogRepository } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { resolveActiveWorktreePath } from "#web/features/repository-refs/activate-repository-ref";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import { RepositoryScopeProvider } from "#web/features/repository-scope/repository-scope-provider";
import { useEnvironment } from "#web/platform/query/environment-context";
import { useStore } from "#web/platform/store/use-store";

export function RepositorySelectionProvider({
  navigation,
  navigate,
  opened,
  children,
}: {
  readonly navigation: Navigation;
  readonly navigate: Navigate;
  readonly opened: OpenedRepositoryStore;
  readonly children: ReactNode;
}) {
  const { connected, readable, writable } = useEnvironment();
  const { selectedRepositoryId, workspaceView } = navigation.projects;
  const selected = useCatalogRepository(selectedRepositoryId);
  const repository = workspaceView === "repository" ? selected : undefined;
  const preferredWorktreePath =
    selected === undefined
      ? ""
      : worktreePathFor(navigation.worktreePaths, selected);
  const refs = useLiveRefs(selected);
  const worktreePath =
    refs === undefined
      ? preferredWorktreePath
      : resolveActiveWorktreePath(refs, preferredWorktreePath);
  const history = useOpenedRepositoryHistory(
    opened,
    repository,
    preferredWorktreePath,
    refs,
  );
  const switchWorktree = useCallback(
    (path: string) => {
      if (selectedRepositoryId !== undefined)
        navigate({
          type: "switch-worktree",
          repositoryId: selectedRepositoryId,
          worktreePath: path,
        });
    },
    [navigate, selectedRepositoryId],
  );
  const scope = useMemo(
    () =>
      repository === undefined
        ? undefined
        : {
            repositoryId: repository.id,
            logicalRepositoryId:
              repository.logicalRepositoryId ?? repository.id,
            worktreePath,
            connected,
            readable,
            writable,
            switchWorktree,
          },
    [repository, worktreePath, connected, readable, writable, switchWorktree],
  );
  return (
    <RepositoryScopeProvider scope={scope}>
      <OpenedHistoryContext.Provider value={history}>
        {children}
      </OpenedHistoryContext.Provider>
    </RepositoryScopeProvider>
  );
}

function useLiveRefs(repository: RepositoryCatalogEntry | undefined) {
  const { refs, restored } = useRepositoryRefs(
    repository?.id,
    repository?.logicalRepositoryId ?? repository?.id,
  );
  return restored ? undefined : refs;
}

function useOpenedRepositoryHistory(
  opened: OpenedRepositoryStore,
  repository: RepositoryCatalogEntry | undefined,
  worktreePath: string,
  refs: RepositoryRefs | undefined,
) {
  const { environmentId } = useEnvironment();
  const snapshot = useStore(opened);
  const target = useMemo(
    () =>
      repository === undefined || environmentId === undefined
        ? undefined
        : openedRepositoryTarget(environmentId, repository, worktreePath),
    [environmentId, repository, worktreePath],
  );
  useEffect(() => opened.open(target), [opened, target]);
  useEffect(() => {
    if (snapshot !== undefined && refs !== undefined) opened.refsArrived(refs);
  }, [opened, snapshot, refs]);
  return target !== undefined && snapshot?.key === openedRepositoryKey(target)
    ? snapshot.history
    : undefined;
}
