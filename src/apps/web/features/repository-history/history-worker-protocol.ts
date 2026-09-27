import type {
  RepositoryCommit,
  RepositoryHistoryFailure,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import type { CommitLaneRow } from "#web/features/repository-history/commit-lanes.ts";
import type {
  HistoryScopeQuery,
  HistoryTarget,
} from "#web/features/repository-history/history-view.ts";
import type { EnvironmentAccess } from "#web/platform/environment/environment-connection.ts";

export interface HistoryIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly logicalRepositoryId: string;
}

export type HistoryFailure =
  | { readonly _tag: "Offline" }
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "StorageUnavailable" }
  | { readonly _tag: "Rejected"; readonly failure: RepositoryHistoryFailure };

export interface HistorySnapshot {
  readonly revision: number;
  readonly status: "loading" | "ready" | "empty" | "error";
  readonly synchronization: "idle" | "syncing" | "complete" | "stale";
  readonly commitCount: number;
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly failure?: HistoryFailure;
}

export interface HistoryRow {
  readonly commit: RepositoryCommit;
  readonly lane: CommitLaneRow;
  readonly merge?: "collapsed" | "expanded";
}

export interface HistoryRows {
  readonly total: number;
  readonly start: number;
  readonly shift: number;
  readonly rows: readonly HistoryRow[];
}

export interface HistorySearchPage {
  readonly commits: readonly RepositoryCommit[];
  readonly cursor?: string;
  readonly complete: boolean;
  readonly commitCount: number;
}

export interface HistoryCache {
  readonly environmentId: string;
  readonly repositoryId: string;
  readonly estimatedBytes?: number;
  readonly commitCount: number;
  readonly lastOpenedAt: number;
  readonly open: boolean;
  readonly state: "empty" | "partial" | "complete";
}

export interface HistoryStorage {
  readonly caches: readonly HistoryCache[];
  readonly persistent: boolean;
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
}

export type HistoryStorageAction =
  | "inspect"
  | "clear"
  | "rebuild"
  | "remove"
  | "clear-all";

export type HistoryQuery =
  | {
      readonly _tag: "Rows";
      readonly scope: HistoryScopeQuery;
      readonly start: number;
      readonly end: number;
      readonly anchor?: { readonly oid: string; readonly index: number };
    }
  | {
      readonly _tag: "Oids";
      readonly scope: HistoryScopeQuery;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly _tag: "Locate";
      readonly scope: HistoryScopeQuery;
      readonly oids: readonly string[];
    }
  | {
      readonly _tag: "Find";
      readonly scope: HistoryScopeQuery;
      readonly oid: string;
    }
  | {
      readonly _tag: "Search";
      readonly text: string;
      readonly limit: number;
      readonly cursor?: string;
    }
  | { readonly _tag: "Commits"; readonly oids: readonly string[] }
  | { readonly _tag: "Storage"; readonly action: HistoryStorageAction };

export interface HistoryAnswers {
  readonly Rows: HistoryRows;
  readonly Oids: readonly string[];
  readonly Locate: readonly (number | undefined)[];
  readonly Find: HistoryTarget | undefined;
  readonly Search: HistorySearchPage;
  readonly Commits: readonly RepositoryCommit[];
  readonly Storage: HistoryStorage;
}

export interface HistoryPortOffer {
  readonly lease?: string;
}

export interface HistoryWorkerLease {
  readonly lease: string;
}

export type HistoryClientMessage =
  | {
      readonly _tag: "Open";
      readonly identity: HistoryIdentity;
      readonly environment?: EnvironmentAccess;
    }
  | { readonly _tag: "Connect"; readonly environment: EnvironmentAccess }
  | { readonly _tag: "Synchronize" }
  | { readonly _tag: "Ask"; readonly id: number; readonly query: HistoryQuery }
  | { readonly _tag: "Cancel"; readonly id: number }
  | { readonly _tag: "Close" };

export type HistoryWorkerMessage =
  | { readonly _tag: "Snapshot"; readonly snapshot: HistorySnapshot }
  | { readonly _tag: "Answer"; readonly id: number; readonly value: unknown }
  | {
      readonly _tag: "Failed";
      readonly id: number;
      readonly failure: HistoryFailure;
    };
