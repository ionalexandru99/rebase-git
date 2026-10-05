import { useLayoutEffect, useRef, useState } from "react";
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

const storagePrefix = "rebase:history-filter:v1";

export function useHistoryScope(
  environmentId: string,
  { logicalRepositoryId, worktreePath: activeWorktreePath }: RepositoryScope,
  { refs, restored: refsRestored }: RepositoryRefsRead,
) {
  const [historyScope, setHistoryScope] = useState<HistoryScope>(() =>
    loadHistoryScope(environmentId, logicalRepositoryId),
  );
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
  const change = (next: HistoryScope) => {
    setHistoryScope(next);
    saveHistoryScope(environmentId, logicalRepositoryId, next);
  };
  const historyScopeRef = useRef(historyScope);
  useLayoutEffect(() => {
    historyScopeRef.current = historyScope;
  });
  const renameBranch = (branch: {
    readonly name: string;
    readonly newName: string;
  }) =>
    change(
      renameHistoryBranch(historyScopeRef.current, branch.name, branch.newName),
    );
  const toggleRef = (target: HistorySelection) => {
    if (refs === undefined) return;
    change(
      resolveHistoryScope(
        toggleHistoryRef(historyScope, target, refs, activeWorktreePath),
        refs,
        activeWorktreePath,
      ).scope,
    );
  };
  const reset = () => change(automaticHistoryScope);
  return {
    renameBranch,
    resolvedScope,
    toggleRef,
    reset: canReset ? reset : undefined,
  };
}

export type WorkspaceHistoryScope = ReturnType<typeof useHistoryScope>;

function loadHistoryScope(
  environmentId: string,
  repositoryId: string,
): HistoryScope {
  try {
    const value = localStorage.getItem(
      historyFilterStorageKey(environmentId, repositoryId),
    );
    return value === null ? automaticHistoryScope : decodeScope(value);
  } catch {
    return automaticHistoryScope;
  }
}

function saveHistoryScope(
  environmentId: string,
  repositoryId: string,
  scope: HistoryScope,
) {
  try {
    localStorage.setItem(
      historyFilterStorageKey(environmentId, repositoryId),
      JSON.stringify({ scope, version: 1 }),
    );
  } catch {}
}

function historyFilterStorageKey(environmentId: string, repositoryId: string) {
  return `${storagePrefix}:${environmentId}:${repositoryId}`;
}

function decodeScope(value: string): HistoryScope {
  const record = JSON.parse(value) as unknown;
  if (!isRecord(record) || record.version !== 1 || !isRecord(record.scope)) {
    return automaticHistoryScope;
  }
  if (record.scope._tag === "Automatic") return automaticHistoryScope;
  if (
    record.scope._tag !== "Custom" ||
    !Array.isArray(record.scope.selections) ||
    record.scope.selections.length === 0 ||
    !record.scope.selections.every(isHistorySelection)
  ) {
    return automaticHistoryScope;
  }
  return { _tag: "Custom", selections: record.scope.selections };
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
