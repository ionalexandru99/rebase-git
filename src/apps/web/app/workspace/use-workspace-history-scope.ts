import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  automaticHistoryScope,
  createBrowserHistoryFilterStore,
  type HistoryScope,
  historyScopesEqual,
  renameHistoryBranch,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/index";

export function useWorkspaceHistoryScope({
  environmentId,
  logicalRepositoryId,
  activeWorktreePath,
  refs,
  refsRestored,
}: {
  readonly environmentId: string | undefined;
  readonly logicalRepositoryId: string | undefined;
  readonly activeWorktreePath: string;
  readonly refs: RepositoryRefs | undefined;
  readonly refsRestored: boolean;
}) {
  const filterStore = useMemo(() => createBrowserHistoryFilterStore(), []);
  const [historyScope, setHistoryScope] = useState<HistoryScope>(() =>
    environmentId === undefined || logicalRepositoryId === undefined
      ? automaticHistoryScope
      : filterStore.load(environmentId, logicalRepositoryId),
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
      if (environmentId !== undefined && logicalRepositoryId !== undefined) {
        filterStore.save(environmentId, logicalRepositoryId, next);
      }
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
