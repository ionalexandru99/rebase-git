import { RepositoryId } from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

export const RepositoryMissing = Schema.TaggedStruct("RepositoryMissing", {
  repositoryId: RepositoryId,
});
export type RepositoryMissing = typeof RepositoryMissing.Type;

export const GitFailed = Schema.TaggedStruct("GitFailed", {
  detail: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
  reason: Schema.Literals([
    "GitUnavailable",
    "NotRepository",
    "Timeout",
    "OutputTooLarge",
    "Failed",
  ]),
});
export type GitFailed = typeof GitFailed.Type;
