import { Schema } from "effect";
import { repositoryCommand } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const PushDestination = Schema.Struct({
  remote: RemoteName,
  branch: RefName,
});
export type PushDestination = typeof PushDestination.Type;

export const PushMode = Schema.Union([
  Schema.TaggedStruct("FastForward", {}),
  Schema.TaggedStruct("ForceWithLease", { expectedOid: ObjectId }),
]);
export type PushMode = typeof PushMode.Type;

export const PushBranch = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
  destination: PushDestination,
  setUpstream: Schema.Boolean,
  mode: PushMode,
});
export type PushBranch = typeof PushBranch.Type;

export const RemoteBranchUpdated = Schema.Struct({
  destination: PushDestination,
  target: ObjectId,
});
export type RemoteBranchUpdated = typeof RemoteBranchUpdated.Type;

export const PushTags = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  remote: RemoteName,
  tags: Schema.Array(RefName).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100),
  ),
});
export type PushTags = typeof PushTags.Type;

export const TagsPushed = Schema.Struct({
  remote: RemoteName,
  pushed: Schema.Array(RefName),
  upToDate: Schema.Array(RefName),
});
export type TagsPushed = typeof TagsPushed.Type;

export const PushRejectedReason = Schema.Literals([
  "RemoteMissing",
  "InvalidBranch",
  "TagExists",
  "NonFastForward",
  "LeaseRejected",
  "HookDeclined",
  "Authentication",
  "Network",
]);
export type PushRejectedReason = typeof PushRejectedReason.Type;

export const PushRejected = Schema.TaggedStruct("PushRejected", {
  reason: PushRejectedReason,
  detail: Schema.String.check(Schema.isMaxLength(2_048)),
});
export type PushRejected = typeof PushRejected.Type;

export const RepositoryPushApi = {
  push: repositoryCommand("repositories/push", {
    request: PushBranch,
    success: RemoteBranchUpdated,
    failure: PushRejected,
  }),
  pushTags: repositoryCommand("repositories/push/tags", {
    request: PushTags,
    success: TagsPushed,
    failure: PushRejected,
  }),
};
