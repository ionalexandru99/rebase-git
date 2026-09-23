import type {
  ChangeDiff,
  ChangesScope,
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
  ) => Effect.Effect<RepositoryChanges, WorkingChangesError>;
  readonly commit: (
    command: CommitChanges,
  ) => Effect.Effect<RepositoryChanges, WorkingChangesError>;
}
export interface CommitDraft {
  readonly subject: string;
  readonly description: string;
}
export {
  type DiffPreferences,
  defaultDiffPreferences,
} from "#web/features/file-diff/file-diff.contract";
export const emptyCommitDraft: CommitDraft = { subject: "", description: "" };
