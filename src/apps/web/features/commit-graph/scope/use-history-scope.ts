import {
  automaticHistoryScope,
  type HistoryScope,
  type HistorySelection,
  historyScopesEqual,
  renameHistoryBranch,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/scope/history-scope.ts";
import type { RepositoryRefsRead } from "#web/features/refs/repository-refs.ts";
import type { RepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useStoredStore } from "#web/platform/store/stored-store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

export function useHistoryScope(
  environmentId: string,
  { logicalRepositoryId, worktreePath: activeWorktreePath }: RepositoryScope,
  { refs, restored: refsRestored }: RepositoryRefsRead,
) {
  const store = useStoredStore(
    `rebase:history-filter:v1:${environmentId}:${logicalRepositoryId}`,
    decodeScope,
  );
  const historyScope = useStore(store);
  const resolvedScope =
    refs === undefined
      ? undefined
      : resolveHistoryScope(historyScope, refs, activeWorktreePath, {
          removeMissingSelections: !refsRestored,
        });
  const canReset =
    refs !== undefined &&
    resolvedScope !== undefined &&
    !historyScopesEqual(
      { _tag: "Custom", selections: resolvedScope.selections },
      {
        _tag: "Custom",
        selections: resolveHistoryScope(
          automaticHistoryScope,
          refs,
          activeWorktreePath,
        ).selections,
      },
    );
  const renameBranch = (branch: {
    readonly name: string;
    readonly newName: string;
  }) =>
    store.set(
      renameHistoryBranch(store.getSnapshot(), branch.name, branch.newName),
    );
  const toggleRef = (target: HistorySelection) => {
    if (refs === undefined) return;
    store.set(
      resolveHistoryScope(
        toggleHistoryRef(historyScope, target, refs, activeWorktreePath),
        refs,
        activeWorktreePath,
      ).scope,
    );
  };
  const reset = () => store.set(automaticHistoryScope);
  return {
    renameBranch,
    resolvedScope,
    toggleRef,
    reset: canReset ? reset : undefined,
  };
}

export type WorkspaceHistoryScope = ReturnType<typeof useHistoryScope>;

function decodeScope(saved: unknown): HistoryScope {
  if (
    !isRecord(saved) ||
    saved._tag !== "Custom" ||
    !Array.isArray(saved.selections) ||
    saved.selections.length === 0 ||
    !saved.selections.every(isHistorySelection)
  ) {
    return automaticHistoryScope;
  }
  return { _tag: "Custom", selections: saved.selections };
}

function isHistorySelection(value: unknown): value is HistorySelection {
  if (!isRecord(value)) return false;
  if (value._tag === "Commit")
    return typeof value.oid === "string" && /^[0-9a-f]{40,64}$/.test(value.oid);
  if (!isNonEmptyString(value.name)) return false;
  if (value._tag === "LocalBranch" || value._tag === "Tag") return true;
  return value._tag === "RemoteBranch" && isNonEmptyString(value.remote);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}
