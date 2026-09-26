import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { useCallback, useState } from "react";
import {
  resolveActiveWorktreePath,
  useRepositoryRefs,
} from "#web/features/repository-refs/index";

export function useActiveWorktree(
  repository: RepositoryCatalogEntry | undefined,
) {
  const { refs } = useRepositoryRefs(
    repository?.id,
    repository?.logicalRepositoryId ?? repository?.id,
  );
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
