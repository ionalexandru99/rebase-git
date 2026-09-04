import type {
  RepositoryCommit,
  RepositoryHistoryOperationFailure,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryRefTarget,
} from "#web/features/repository-history/repository-history-reader.contract";

export type RepositoryHistoryWorkerFailure =
  | {
      readonly _tag: "Rejected";
      readonly detail: RepositoryHistoryOperationFailure;
    }
  | { readonly _tag: "Offline" }
  | { readonly _tag: "StorageUnavailable" }
  | { readonly _tag: "Unavailable" };

export type RepositoryHistoryWorkerRequest =
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
      readonly revision: number;
      readonly status: "empty" | "error" | "loading" | "ready";
      readonly synchronization: "complete" | "idle" | "stale" | "syncing";
      readonly synchronizedCommitCount: number;
      readonly failure?: RepositoryHistoryWorkerFailure;
    };

export interface ConnectRepositoryHistoryReader {
  readonly _tag: "ConnectRepositoryHistoryReader";
  readonly environmentId: string;
  readonly logicalRepositoryId: string;
  readonly lifetimeLock?: string;
  readonly port: MessagePort;
  readonly repositoryId: string;
}
