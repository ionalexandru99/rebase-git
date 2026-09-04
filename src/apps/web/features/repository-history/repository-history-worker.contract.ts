import type {
  RepositoryCommit,
  RepositoryHistoryOperationFailure,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import type { HistoryAncestryRoute } from "#web/features/repository-history/history-order.contract";
import type {
  RepositoryHistoryPosition,
  RepositoryHistoryQuery,
  RepositoryHistoryRefTarget,
} from "#web/features/repository-history/repository-history-reader.contract";
import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryStorageDiagnostics,
} from "#web/features/repository-history/repository-history-storage.contract";

export type RepositoryHistoryWorkerFailure =
  | {
      readonly _tag: "Rejected";
      readonly detail: RepositoryHistoryOperationFailure;
    }
  | { readonly _tag: "Offline" }
  | { readonly _tag: "StorageUnavailable" }
  | { readonly _tag: "Unavailable" };

export type RepositoryHistoryWorkerRequest =
  | { readonly _tag: "GetCacheDiagnostics"; readonly requestId: string }
  | {
      readonly _tag: "ManageCache";
      readonly action: RepositoryHistoryCacheAction;
      readonly requestId: string;
    }
  | {
      readonly _tag: "LocateHistoryCommits";
      readonly query: RepositoryHistoryQuery;
      readonly oids: readonly string[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "GetAncestryRoute";
      readonly roots: readonly string[];
      readonly oid: string;
      readonly requestId: string;
    }
  | {
      readonly _tag: "LocateHistoryCommit";
      readonly query: RepositoryHistoryQuery;
      readonly oid: string;
      readonly requestId: string;
    }
  | {
      readonly _tag: "ReadHistory";
      readonly requestId: string;
      readonly query: RepositoryHistoryQuery;
    }
  | {
      readonly _tag: "GetCommitSummaries";
      readonly oids: readonly string[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistoryBatchReceived";
      readonly batchId: string;
      readonly bytes: Uint8Array;
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistorySynchronizationCompleted";
      readonly commitCount: number;
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistorySynchronizationFailed";
      readonly failure: RepositoryHistoryWorkerFailure;
      readonly requestId: string;
    }
  | { readonly _tag: "GetRefTargets"; readonly requestId: string }
  | { readonly _tag: "ReconcileHistory" }
  | {
      readonly _tag: "HistoryPageReceived";
      readonly bytes: Uint8Array;
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistoryPageFailed";
      readonly failure: RepositoryHistoryWorkerFailure;
      readonly requestId: string;
    }
  | { readonly _tag: "CloseReader" };

export type RepositoryHistoryWorkerResponse =
  | { readonly _tag: "CacheRemoved" }
  | {
      readonly _tag: "CacheDiagnosticsResult";
      readonly diagnostics: RepositoryHistoryStorageDiagnostics;
      readonly requestId: string;
    }
  | { readonly _tag: "CacheManaged"; readonly requestId: string }
  | {
      readonly _tag: "HistoryPositionsResult";
      readonly positions: readonly RepositoryHistoryPosition[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "AncestryRouteResult";
      readonly route: HistoryAncestryRoute | undefined;
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistoryPositionResult";
      readonly position: number | undefined;
      readonly requestId: string;
    }
  | {
      readonly _tag: "LoadHistory";
      readonly query: RepositoryHistoryQuery;
      readonly requestId: string;
    }
  | {
      readonly _tag: "CancelHistoryLoad";
      readonly requestId: string;
    }
  | {
      readonly _tag: "SynchronizeHistory";
      readonly basis?: SynchronizeRepositoryHistory["basis"];
      readonly requestId: string;
    }
  | {
      readonly _tag: "CancelHistorySynchronization";
      readonly requestId: string;
    }
  | {
      readonly _tag: "HistoryBatchCommitted";
      readonly batchId: string;
    }
  | {
      readonly _tag: "HistoryBatchFailed";
      readonly batchId: string;
      readonly failure: RepositoryHistoryWorkerFailure;
    }
  | {
      readonly _tag: "HistoryResult";
      readonly commits: readonly RepositoryCommit[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "CommitSummariesResult";
      readonly commits: readonly RepositoryCommit[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "RefTargetsResult";
      readonly refs: readonly RepositoryHistoryRefTarget[];
      readonly requestId: string;
    }
  | {
      readonly _tag: "RequestFailed";
      readonly failure: RepositoryHistoryWorkerFailure;
      readonly requestId: string;
    }
  | {
      readonly _tag: "SnapshotChanged";
      readonly cachePaused?: boolean;
      readonly historyRevision: number;
      readonly revision: number;
      readonly status: "empty" | "error" | "loading" | "ready";
      readonly synchronization: "complete" | "idle" | "stale" | "syncing";
      readonly synchronizedCommitCount: number;
      readonly failure?: RepositoryHistoryWorkerFailure;
    };

export interface ConnectRepositoryHistoryReader {
  readonly _tag: "ConnectRepositoryHistoryReader";
  readonly cachePaused?: boolean;
  readonly environmentId: string;
  readonly logicalRepositoryId: string;
  readonly lifetimeLock?: string;
  readonly port: MessagePort;
  readonly repositoryId: string;
}
