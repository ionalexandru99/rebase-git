import type { RepositoryFreshness } from "@rebase/contracts";
import type { Fiber, Scope } from "effect";
import type { HistoryOrderCache } from "#web/features/repository-history/query/history-order.contract";
import type { RepositoryHistoryEpoch } from "#web/features/repository-history/reader/repository-history-epoch";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";
import type {
  ConnectRepositoryHistoryReader,
  RepositoryHistoryWorkerFailure,
  RepositoryHistoryWorkerRequest,
  RepositoryHistoryWorkerResponse,
} from "#web/features/repository-history/worker/repository-history-worker.contract";

export interface ConnectedReader {
  stopWatchingLease: () => void;
  search?: { readonly requestId: string; readonly fiber: Fiber.Fiber<void> };
  readonly scope: Scope.Closeable;
  closed: boolean;
  lastQuery?: RepositoryHistoryQuery;
  readonly connection: ConnectRepositoryHistoryReader;
  readonly epoch: RepositoryHistoryEpoch;
  readonly queries: Map<string, RepositoryHistoryQuery>;
}

export interface HistorySynchronizationState {
  reconciled: boolean;
  needsReconciliation: boolean;
  synchronization: HistorySynchronization;
}

export interface RepositoryReplica extends HistorySynchronizationState {
  readonly orderCache: HistoryOrderCache;
  shallowOids: readonly string[];
  freshness?: RepositoryFreshness;
  freshnessFailure?: RepositoryHistoryWorkerFailure;
  freshnessOwner?: ConnectedReader;
  readonly freshnessCommands: Map<string, ConnectedReader>;
  cachePaused?: boolean;
  storageExhausted?: boolean;
  failure?: RepositoryHistoryWorkerFailure;
  initialization: Promise<void>;
  revision: number;
  refTargets: Extract<
    RepositoryHistoryWorkerResponse,
    { _tag: "RefTargetsResult" }
  >["refs"];
  readonly readers: Set<ConnectedReader>;
  status: "empty" | "error" | "loading" | "ready";
  synchronizedCommitCount: number;
}

export type HistorySynchronization =
  | { readonly status: "complete" | "idle" | "stale" }
  | ActiveHistorySynchronization;

export interface ActiveHistorySynchronization {
  readonly status: "syncing";
  readonly owner: ConnectedReader;
  readonly requestId: string;
  readonly previous: "idle" | "stale";
  storingCommits: boolean;
}

export type ReaderMessageHandler = (
  reader: ConnectedReader,
  replica: RepositoryReplica,
  message: RepositoryHistoryWorkerRequest,
) => Promise<void>;
