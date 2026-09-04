import type {
  ReadRepositoryHistory,
  RepositoryHistoryBatch,
  RepositoryHistoryOperationFailure,
  RepositoryHistoryPage,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

export interface RepositoryHistoryService {
  readonly read: (
    request: ReadRepositoryHistory,
  ) => Effect.Effect<
    RepositoryHistoryPage,
    EnvironmentStorageError | RepositoryHistoryError
  >;
  readonly synchronize: (
    request: SynchronizeRepositoryHistory,
    emit: (
      batch: RepositoryHistoryBatch,
    ) => Effect.Effect<void, RepositoryHistoryError>,
  ) => Effect.Effect<number, EnvironmentStorageError | RepositoryHistoryError>;
}

export class RepositoryHistoryError extends Data.TaggedError(
  "RepositoryHistoryError",
)<{
  readonly cause?: unknown;
  readonly failure: RepositoryHistoryOperationFailure;
}> {}
