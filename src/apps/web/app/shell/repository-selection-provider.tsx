import type { ReactNode } from "react";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import {
  type Navigate,
  type Navigation,
  worktreePathFor,
} from "#web/app/shell/use-navigation.ts";
import {
  resolveActiveWorktreePath,
  useRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { useCatalogRepository } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

export function RepositorySelectionProvider({
  navigation,
  navigate,
  children,
}: {
  readonly navigation: Navigation;
  readonly navigate: Navigate;
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
  const repositoryId = repository?.id;
  const logicalRepositoryId = repository?.logicalRepositoryId ?? repositoryId;
  const switchWorktree = (path: string) => {
    if (selectedRepositoryId !== undefined)
      navigate({
        type: "switch-worktree",
        repositoryId: selectedRepositoryId,
        worktreePath: path,
      });
  };
  const scope =
    repositoryId === undefined || logicalRepositoryId === undefined
      ? undefined
      : {
          repositoryId,
          logicalRepositoryId,
          worktreePath,
          connected,
          readable,
          writable,
          switchWorktree,
        };
  return (
    <RepositoryScopeProvider scope={scope}>{children}</RepositoryScopeProvider>
  );
}

function useLiveRefs(repository: RepositoryCatalogEntry | undefined) {
  const { refs, restored } = useRepositoryRefs(repository?.id);
  return restored ? undefined : refs;
}
