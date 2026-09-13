import type {
  ChangeDiff,
  ChangesFailure,
  ChangesScope,
  CommitChanges,
  MutateChanges,
  ReadChangeDiff,
  RepositoryChanges,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Context, Data, type Effect } from "effect";

export class RepositoryChangesError extends Data.TaggedError(
  "RepositoryChangesError",
)<{
  readonly failure: ChangesFailure;
}> {}
export interface RepositoryChangesService {
  readonly read: (
    scope: ChangesScope,
  ) => Effect.Effect<RepositoryChanges, RepositoryChangesError>;
  readonly diff: (
    command: ReadChangeDiff,
  ) => Effect.Effect<ChangeDiff, RepositoryChangesError>;
  readonly mutate: (
    command: MutateChanges,
  ) => Effect.Effect<RepositoryChanges, RepositoryChangesError>;
  readonly commit: (
    command: CommitChanges,
  ) => Effect.Effect<RepositoryChanges, RepositoryChangesError>;
}
export class RepositoryChangesAccess extends Context.Service<
  RepositoryChangesAccess,
  RepositoryChangesService
>()("RepositoryChangesAccess") {}
