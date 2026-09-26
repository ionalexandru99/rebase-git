export interface CommitDraft {
  readonly subject: string;
  readonly description: string;
}

export const emptyCommitDraft: CommitDraft = { subject: "", description: "" };
