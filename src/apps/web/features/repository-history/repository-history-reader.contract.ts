import type {
  ReadRepositoryHistory,
  RepositoryCommit,
  RepositoryHistoryOperationFailure,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";

export type { RepositoryHistoryRefTarget } from "@rebase/contracts";

export interface RepositoryHistorySnapshot {
  readonly error?: RepositoryHistoryReaderError;
  readonly revision: number;
  readonly status: "empty" | "error" | "loading" | "ready";
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

export type RepositoryHistoryReaderError =
  | RepositoryHistoryRejected
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
}

export interface RepositoryHistoryGateway {
  readonly read: (
    request: Omit<ReadRepositoryHistory, "requestId" | "_tag">,
    signal?: AbortSignal,
  ) => Promise<Uint8Array>;
}
