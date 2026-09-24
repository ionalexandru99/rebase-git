import type {
  ChangeDiff,
  ChangesScope,
  ChangesWritten,
  CommitChanges,
  MutateChanges,
  ReadChangeDiff,
  RepositoryChanges,
} from "@rebase/contracts";
import { Data, type Effect } from "effect";

export class WorkingChangesError extends Data.TaggedError(
  "WorkingChangesError",
)<{ readonly message: string }> {}
export interface RepositoryChangesClient {
  readonly read: (
    scope: ChangesScope,
  ) => Effect.Effect<RepositoryChanges, WorkingChangesError>;
  readonly diff: (
    command: ReadChangeDiff,
  ) => Effect.Effect<ChangeDiff, WorkingChangesError>;
  readonly mutate: (
    command: MutateChanges,
  ) => Effect.Effect<ChangesWritten, WorkingChangesError>;
  readonly commit: (
    command: CommitChanges,
  ) => Effect.Effect<ChangesWritten, WorkingChangesError>;
}
