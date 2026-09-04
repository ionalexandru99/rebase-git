import type {
  ReadRepositoryHistory,
  RepositoryCommit,
  RepositoryHistoryOperationFailure,
  RepositoryHistoryRefTarget,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";

export type { RepositoryHistoryRefTarget } from "@rebase/contracts";

export interface RepositoryHistorySnapshot {
  readonly error?: RepositoryHistoryReaderError;
  readonly revision: number;
  readonly status: "empty" | "error" | "loading" | "ready";
  readonly synchronization?: "complete" | "idle" | "syncing";
  readonly synchronizedCommitCount?: number;
}

export interface RepositoryHistoryQuery {
  readonly limit: number;
  readonly order: ReadRepositoryHistory["order"];
  readonly roots: ReadRepositoryHistory["roots"];
}

export interface RepositoryHistoryReader {
  readonly close: () => void;
  readonly getCommitSummaries: (
    oids: readonly string[],
  ) => Promise<readonly RepositoryCommit[]>;
  readonly getSnapshot: () => RepositoryHistorySnapshot;
  readonly getRefTargets: () => Promise<readonly RepositoryHistoryRefTarget[]>;
  readonly read: (
    query: RepositoryHistoryQuery,
  ) => Promise<readonly RepositoryCommit[]>;
  readonly subscribe: (listener: () => void) => () => void;
}

export class RepositoryHistoryRejected extends Data.TaggedError(
  "RepositoryHistoryRejected",
)<{ readonly failure: RepositoryHistoryOperationFailure }> {}

export class RepositoryHistoryUnavailable extends Data.TaggedError(
  "RepositoryHistoryUnavailable",
) {}

export class RepositoryHistoryOffline extends Data.TaggedError(
  "RepositoryHistoryOffline",
) {}

export class RepositoryHistoryStorageUnavailable extends Data.TaggedError(
  "RepositoryHistoryStorageUnavailable",
) {}

export type RepositoryHistoryReaderError =
  | RepositoryHistoryOffline
  | RepositoryHistoryRejected
  | RepositoryHistoryStorageUnavailable
  | RepositoryHistoryUnavailable;

export interface RepositoryHistoryTransport {
  readonly read: (
    request: Omit<ReadRepositoryHistory, "requestId" | "_tag">,
  ) => Effect.Effect<
    Uint8Array,
    | EnvironmentConnectionFailure
    | RepositoryHistoryRejected
    | RepositoryHistoryUnavailable
  >;
  readonly synchronize: (
    request: Omit<SynchronizeRepositoryHistory, "requestId" | "_tag">,
    acceptBatch: (
      bytes: Uint8Array,
    ) => Effect.Effect<void, RepositoryHistoryUnavailable>,
  ) => Effect.Effect<
    number,
    | EnvironmentConnectionFailure
    | RepositoryHistoryRejected
    | RepositoryHistoryUnavailable
  >;
}

export interface RepositoryHistoryGateway {
  readonly read: (
    request: Omit<ReadRepositoryHistory, "requestId" | "_tag">,
    signal?: AbortSignal,
  ) => Promise<Uint8Array>;
  readonly synchronize: (
    request: Omit<SynchronizeRepositoryHistory, "requestId" | "_tag">,
    acceptBatch: (bytes: Uint8Array) => Promise<void>,
    signal?: AbortSignal,
  ) => Promise<number>;
}
