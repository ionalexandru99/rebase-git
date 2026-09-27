import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { ObjectId, RepositoryId } from "#contracts/git/git-values.contract.ts";

const HistoryTips = Schema.Array(ObjectId).check(Schema.isMaxLength(40_512));
const ObjectFormat = Schema.Literals(["sha1", "sha256"]);

const HistoryString = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      new TextEncoder().encode(value).byteLength <= 1_048_576 ||
      "String is too large",
  ),
);

export const RepositoryHistoryRefTarget = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)),
  oid: ObjectId,
  type: Schema.Literals(["branch", "head", "remote-branch", "tag"]),
});
export type RepositoryHistoryRefTarget = typeof RepositoryHistoryRefTarget.Type;

export const RepositoryCommitIdentity = Schema.Struct({
  email: HistoryString,
  name: HistoryString,
  timestampSeconds: Schema.Int,
  timezoneOffsetMinutes: Schema.Int.check(
    Schema.isBetween({ minimum: -32_768, maximum: 32_767 }),
  ),
});
export type RepositoryCommitIdentity = typeof RepositoryCommitIdentity.Type;

export const RepositoryCommit = Schema.Struct({
  author: RepositoryCommitIdentity,
  committer: RepositoryCommitIdentity,
  oid: ObjectId,
  parents: Schema.Array(ObjectId).check(Schema.isMaxLength(4_096)),
  subject: HistoryString,
});
export type RepositoryCommit = typeof RepositoryCommit.Type;

export const SynchronizeRepositoryHistory = Schema.Struct({
  repositoryId: RepositoryId,
  knownTips: HistoryTips,
  shallowOids: HistoryTips,
});
export type SynchronizeRepositoryHistory =
  typeof SynchronizeRepositoryHistory.Type;

export const RepositoryHistoryTips = Schema.TaggedStruct(
  "RepositoryHistoryTips",
  {
    objectFormat: ObjectFormat,
    rootOids: HistoryTips,
    shallowOids: HistoryTips,
    refTargets: Schema.Array(RepositoryHistoryRefTarget).check(
      Schema.isMaxLength(40_512),
    ),
  },
);
export type RepositoryHistoryTips = typeof RepositoryHistoryTips.Type;

export const RepositoryHistoryCommits = Schema.TaggedStruct(
  "RepositoryHistoryCommits",
  { commits: Schema.Array(RepositoryCommit).check(Schema.isMaxLength(512)) },
);
export type RepositoryHistoryCommits = typeof RepositoryHistoryCommits.Type;

export const RepositoryHistoryUpdate = Schema.Union([
  RepositoryHistoryTips,
  RepositoryHistoryCommits,
]);
export type RepositoryHistoryUpdate = typeof RepositoryHistoryUpdate.Type;

export const RepositoryHistoryFailure = Schema.Union([
  Schema.TaggedStruct("RepositoryMissing", { repositoryId: RepositoryId }),
  Schema.TaggedStruct("GitFailed", {
    detail: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
    reason: Schema.Literals([
      "GitUnavailable",
      "NotRepository",
      "Timeout",
      "OutputTooLarge",
      "Failed",
    ]),
  }),
]);
export type RepositoryHistoryFailure = typeof RepositoryHistoryFailure.Type;

export const RepositoryHistoryRpc = RpcGroup.make(
  Rpc.make("SynchronizeHistory", {
    payload: SynchronizeRepositoryHistory,
    success: RepositoryHistoryUpdate,
    error: RepositoryHistoryFailure,
    stream: true,
  }),
);
