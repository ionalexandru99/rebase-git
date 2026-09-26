import type { RepositoryRefTarget } from "@rebase/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import { createBrowserHistoryFilterStore } from "#web/features/commit-graph/scope/browser-history-filter-store";
import {
  historyScopesEqual,
  renameHistoryBranch,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/scope/history-scope";
import {
  automaticHistoryScope,
  type HistoryScope,
} from "#web/features/commit-graph/scope/history-scope-model";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";
import type { RepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

export function useWorkspaceHistoryScope(
  environmentId: string,
  { logicalRepositoryId, worktreePath: activeWorktreePath }: RepositoryScope,
  { refs, restored: refsRestored }: RepositoryRefsRead,
) {
  const filterStore = useMemo(() => createBrowserHistoryFilterStore(), []);
  const [historyScope, setHistoryScope] = useState<HistoryScope>(() =>
    filterStore.load(environmentId, logicalRepositoryId),
  );
  const resolvedScope = useMemo(
    () =>
      refs === undefined
        ? undefined
        : resolveHistoryScope(historyScope, refs, activeWorktreePath, {
            removeMissingSelections: !refsRestored,
          }),
    [activeWorktreePath, historyScope, refs, refsRestored],
  );
  const canReset = useMemo(() => {
    if (refs === undefined || resolvedScope === undefined) return false;
    const automatic = resolveHistoryScope(
      automaticHistoryScope,
      refs,
      activeWorktreePath,
    );
    return !historyScopesEqual(
      { _tag: "Custom", selections: resolvedScope.selections },
      { _tag: "Custom", selections: automatic.selections },
    );
  }, [activeWorktreePath, refs, resolvedScope]);
  const change = useCallback(
    (next: HistoryScope) => {
      setHistoryScope(next);
      filterStore.save(environmentId, logicalRepositoryId, next);
    },
    [environmentId, filterStore, logicalRepositoryId],
  );
  const historyScopeRef = useRef(historyScope);
  historyScopeRef.current = historyScope;
  const renameBranch = useCallback(
    (branch: { readonly name: string; readonly newName: string }) =>
      change(
        renameHistoryBranch(
          historyScopeRef.current,
          branch.name,
          branch.newName,
        ),
      ),
    [change],
  );
  const toggleRef = useCallback(
    (target: RepositoryRefTarget) => {
      if (refs === undefined) return;
      change(
        resolveHistoryScope(
          toggleHistoryRef(historyScope, target, refs, activeWorktreePath),
          refs,
          activeWorktreePath,
        ).scope,
      );
    },
    [activeWorktreePath, change, historyScope, refs],
  );
  const reset = useCallback(() => change(automaticHistoryScope), [change]);
  return {
    renameBranch,
    resolvedScope,
    toggleRef,
    reset: canReset ? reset : undefined,
  };
}

export type WorkspaceHistoryScope = ReturnType<typeof useWorkspaceHistoryScope>;
