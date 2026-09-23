import { Data } from "effect";

export class WorkingChangesStoreUnavailable extends Data.TaggedError(
  "WorkingChangesStoreUnavailable",
)<{ readonly message: string }> {}

export interface CommitDraft {
  readonly subject: string;
  readonly description: string;
}

export const emptyCommitDraft: CommitDraft = { subject: "", description: "" };
