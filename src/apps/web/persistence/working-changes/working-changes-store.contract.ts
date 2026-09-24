import { Data, type Effect } from "effect";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";

export class WorkingChangesStoreUnavailable extends Data.TaggedError(
  "WorkingChangesStoreUnavailable",
)<{ readonly message: string }> {}

export interface CommitDraft {
  readonly subject: string;
  readonly description: string;
}

export const emptyCommitDraft: CommitDraft = { subject: "", description: "" };

export interface WorkingChangesStore {
  readonly readCommitDraft: (
    key: string,
  ) => Effect.Effect<CommitDraft, WorkingChangesStoreUnavailable>;
  readonly saveCommitDraft: (
    key: string,
    draft: CommitDraft,
  ) => Effect.Effect<void, WorkingChangesStoreUnavailable>;
  readonly readDiffPreferences: () => Effect.Effect<
    DiffPreferences,
    WorkingChangesStoreUnavailable
  >;
  readonly saveDiffPreferences: (
    preferences: DiffPreferences,
  ) => Effect.Effect<void, WorkingChangesStoreUnavailable>;
}

export type DiffPreferencesStore = Pick<
  WorkingChangesStore,
  "readDiffPreferences" | "saveDiffPreferences"
>;
