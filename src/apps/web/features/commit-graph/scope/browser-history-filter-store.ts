import type { RepositoryRefTarget } from "@rebase/contracts";
import {
  automaticHistoryScope,
  type HistoryScope,
} from "#web/features/commit-graph/history-scope.contract";

const storagePrefix = "rebase:history-filter:v1";

export interface HistoryFilterStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => unknown;
}

export interface BrowserHistoryFilterStore {
  readonly load: (environmentId: string, repositoryId: string) => HistoryScope;
  readonly save: (
    environmentId: string,
    repositoryId: string,
    scope: HistoryScope,
  ) => void;
}

export function createBrowserHistoryFilterStore(
  storage?: HistoryFilterStorage,
): BrowserHistoryFilterStore {
  return {
    load: (environmentId, repositoryId) => {
      try {
        const value = (storage ?? globalThis.localStorage).getItem(
          historyFilterStorageKey(environmentId, repositoryId),
        );
        return value === null ? automaticHistoryScope : decodeScope(value);
      } catch {
        return automaticHistoryScope;
      }
    },
    save: (environmentId, repositoryId, scope) => {
      try {
        (storage ?? globalThis.localStorage).setItem(
          historyFilterStorageKey(environmentId, repositoryId),
          JSON.stringify({ scope, version: 1 }),
        );
      } catch {
        return;
      }
    },
  };
}

export function historyFilterStorageKey(
  environmentId: string,
  repositoryId: string,
) {
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
    !record.scope.selections.every(isRefTarget)
  ) {
    return automaticHistoryScope;
  }
  return { _tag: "Custom", selections: record.scope.selections };
}

function isRefTarget(value: unknown): value is RepositoryRefTarget {
  if (!isRecord(value) || !isNonEmptyString(value.name)) return false;
  if (value._tag === "LocalBranch" || value._tag === "Tag") return true;
  return value._tag === "RemoteBranch" && isNonEmptyString(value.remote);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024;
}
