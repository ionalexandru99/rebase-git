import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import { RefMissing } from "#contracts/repository-refs/repository-refs.contract.ts";

const ReflogText = Schema.String.check(Schema.isMaxLength(1_024));
const maximumEntries = 2_000;

export const ReflogRef = Schema.Union([
  Schema.TaggedStruct("Head", {}),
  Schema.TaggedStruct("LocalBranch", { name: RefName }),
]);
export type ReflogRef = typeof ReflogRef.Type;
export const isReflogRef = Schema.is(ReflogRef);

export const ReadRepositoryReflog = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  ref: ReflogRef,
});
export type ReadRepositoryReflog = typeof ReadRepositoryReflog.Type;

export const ReflogAction = Schema.Literals([
  "commit",
  "amend",
  "merge",
  "switch",
  "reset",
  "rebase",
  "pull",
  "cherry-pick",
  "created",
  "other",
]);
export type ReflogAction = typeof ReflogAction.Type;

export const ReflogStep = Schema.Struct({
  oid: ObjectId,
  label: Schema.String.check(Schema.isMaxLength(32)),
  description: ReflogText,
});
export type ReflogStep = typeof ReflogStep.Type;

export const ReflogEntry = Schema.Struct({
  oid: ObjectId,
  previousOid: Schema.NullOr(ObjectId),
  action: ReflogAction,
  description: ReflogText,
  subject: ReflogText,
  recordedAt: Schema.Int,
  orphaned: Schema.Boolean,
  steps: Schema.Array(ReflogStep).check(Schema.isMaxLength(maximumEntries)),
});
export type ReflogEntry = typeof ReflogEntry.Type;

export const RepositoryReflog = Schema.Struct({
  entries: Schema.Array(ReflogEntry).check(Schema.isMaxLength(maximumEntries)),
  truncated: Schema.Boolean,
});
export type RepositoryReflog = typeof RepositoryReflog.Type;

export const ResetMode = Schema.Literals(["soft", "mixed", "hard"]);
export type ResetMode = typeof ResetMode.Type;

export const ResetToCommit = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  target: ObjectId,
  mode: ResetMode,
  expectedHead: ObjectId,
  discard: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
});
export type ResetToCommit = typeof ResetToCommit.Type;

export const HeadMoved = Schema.TaggedStruct("HeadMoved", {
  head: Schema.NullOr(ObjectId),
});
export type HeadMoved = typeof HeadMoved.Type;

export const ResetDiscardsChanges = Schema.TaggedStruct(
  "ResetDiscardsChanges",
  {
    paths: Schema.Array(Schema.String).check(Schema.isMaxLength(20)),
    count: Schema.Natural,
    fingerprint: Schema.String.check(Schema.isMaxLength(128)),
  },
);
export type ResetDiscardsChanges = typeof ResetDiscardsChanges.Type;

export const ResetFailure = Schema.Union([
  HeadMoved,
  ResetDiscardsChanges,
  RefMissing,
]);
export type ResetFailure = typeof ResetFailure.Type;

export const RepositoryReflogApi = {
  read: repositoryQuery("repositories/reflog/read", {
    request: ReadRepositoryReflog,
    success: RepositoryReflog,
  }),
  reset: repositoryCommand("repositories/reflog/reset", {
    request: ResetToCommit,
    success: Schema.Struct({ head: ObjectId }),
    failure: ResetFailure,
  }),
};
