import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { useCallback, useState } from "react";
import { resolveActiveWorktreePath } from "#web/features/repository-refs/activate-repository-ref";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";

export function useActiveWorktree(
  repository: RepositoryCatalogEntry | undefined,
  logicalRepositoryId: string | undefined,
) {
  const { refs: readRefs, restored } = useRepositoryRefs(
    repository?.id,
    logicalRepositoryId,
  );
  const refs = restored ? undefined : readRefs;
  const [worktreePaths, setWorktreePaths] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const worktreePathFor = useCallback(
    (entry: RepositoryCatalogEntry) =>
      worktreePaths.get(entry.id) ?? entry.path,
    [worktreePaths],
  );
  const preferredWorktreePath =
    repository === undefined ? "" : worktreePathFor(repository);
  const repositoryId = repository?.id;
  const switchWorktree = useCallback(
    (worktreePath: string) => {
      if (repositoryId === undefined) return;
      setWorktreePaths((current) =>
        new Map(current).set(repositoryId, worktreePath),
      );
    },
    [repositoryId],
  );
  return {
    activeWorktreePath:
      refs === undefined
        ? preferredWorktreePath
        : resolveActiveWorktreePath(refs, preferredWorktreePath),
    refs,
    switchWorktree,
    worktreePathFor,
  };
}
