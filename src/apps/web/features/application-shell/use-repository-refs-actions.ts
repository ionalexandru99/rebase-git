import type {
  RepositoryCatalogEntry,
  RepositoryRefTarget,
} from "@rebase/contracts";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  resolveActiveWorktreePath,
  resolveRefSelection,
} from "#web/features/branches-sidebar/branches-sidebar-state";
import type { LocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session.contract";

export function useRepositoryRefsActions({
  repositories,
  selectedRepositoryId,
  session,
}: {
  readonly repositories: readonly RepositoryCatalogEntry[];
  readonly selectedRepositoryId: string | undefined;
  readonly session: LocalEnvironmentSession;
}) {
  const refs = useSyncExternalStore(
    session.repositoryRefs.subscribe,
    session.repositoryRefs.getSnapshot,
  );
  const [worktreePaths, setWorktreePaths] = useState<
    ReadonlyMap<string, string>
  >(() => new Map());
  const [branchesFocusRequest, setBranchesFocusRequest] = useState(0);

  useEffect(() => {
    session.repositoryRefs.select(selectedRepositoryId);
  }, [selectedRepositoryId, session.repositoryRefs]);

  const selectedRefs =
    refs.refs !== undefined && refs.refs.repositoryId === selectedRepositoryId
      ? refs.refs
      : undefined;
  const preferredWorktreePath =
    (selectedRepositoryId === undefined
      ? undefined
      : worktreePaths.get(selectedRepositoryId)) ??
    repositories.find((repository) => repository.id === selectedRepositoryId)
      ?.path ??
    "";
  const activeWorktreePath =
    selectedRefs === undefined
      ? preferredWorktreePath
      : resolveActiveWorktreePath(selectedRefs, preferredWorktreePath);

  const selectRef = useCallback(
    (target: RepositoryRefTarget) => {
      if (
        selectedRepositoryId === undefined ||
        selectedRefs === undefined ||
        refs.checkingOut
      ) {
        return;
      }
      const selection = resolveRefSelection(
        selectedRefs,
        activeWorktreePath,
        target,
      );
      if (selection._tag === "SwitchWorktree") {
        setWorktreePaths((current) =>
          new Map(current).set(selectedRepositoryId, selection.worktreePath),
        );
        return;
      }
      if (selection._tag === "Checkout") {
        void session.repositoryRefs
          .checkout(activeWorktreePath, selection.target)
          .catch(() => undefined);
      }
    },
    [
      activeWorktreePath,
      refs.checkingOut,
      selectedRefs,
      selectedRepositoryId,
      session.repositoryRefs,
    ],
  );

  const focusBranchesSidebar = useCallback(() => {
    setBranchesFocusRequest((current) => current + 1);
  }, []);

  const retryRefs = useCallback(() => {
    void session.repositoryRefs.refresh().catch(() => undefined);
  }, [session.repositoryRefs]);

  return {
    activeWorktreePath,
    branchesFocusRequest,
    focusBranchesSidebar,
    refs,
    retryRefs,
    selectRef,
  };
}
