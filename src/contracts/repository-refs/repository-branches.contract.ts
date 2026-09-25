import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  GitFailed,
  RepositoryMissing,
} from "@rebase/contracts/git/git-failures.contract";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import {
  BranchCheckedOutElsewhere,
  LocalBranch,
  RefMissing,
  WorktreeMissing,
} from "@rebase/contracts/repository-refs/repository-refs.contract";
import { Schema } from "effect";

export const BranchUpstreamTarget = Schema.Struct({
  name: RefName,
  remote: RemoteName,
});
export type BranchUpstreamTarget = typeof BranchUpstreamTarget.Type;

const BranchScope = {
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
};

export const CreateRepositoryBranch = Schema.Struct({
  ...BranchScope,
  name: RefName,
  startPoint: ObjectId,
  track: Schema.optional(BranchUpstreamTarget),
});
export type CreateRepositoryBranch = typeof CreateRepositoryBranch.Type;

export const RenameRepositoryBranch = Schema.Struct({
  ...BranchScope,
  expectedTarget: Schema.optional(ObjectId),
  name: RefName,
  newName: RefName,
});
export type RenameRepositoryBranch = typeof RenameRepositoryBranch.Type;

export const SetRepositoryBranchUpstream = Schema.Struct({
  ...BranchScope,
  name: RefName,
  upstream: Schema.NullOr(BranchUpstreamTarget),
});
export type SetRepositoryBranchUpstream =
  typeof SetRepositoryBranchUpstream.Type;

const DeletedLocalBranch = Schema.Struct({ name: RefName, target: ObjectId });
const DeletedRemoteBranch = Schema.Struct({
  name: RefName,
  remote: RemoteName,
  target: ObjectId,
});

export const DeleteRepositoryBranch = Schema.Struct({
  ...BranchScope,
  force: Schema.Boolean,
  local: Schema.optional(DeletedLocalBranch),
  remote: Schema.optional(DeletedRemoteBranch),
});
export type DeleteRepositoryBranch = typeof DeleteRepositoryBranch.Type;

export const RepositoryBranchRenamed = Schema.Struct({
  branch: LocalBranch,
  previousName: RefName,
});
export type RepositoryBranchRenamed = typeof RepositoryBranchRenamed.Type;

export const RepositoryBranchDeleted = Schema.Struct({
  local: Schema.optional(DeletedLocalBranch),
  remote: Schema.optional(DeletedRemoteBranch),
});
export type RepositoryBranchDeleted = typeof RepositoryBranchDeleted.Type;

export const BranchCommitSummary = Schema.Struct({
  oid: ObjectId,
  subject: Schema.String.check(Schema.isMaxLength(512)),
});
export type BranchCommitSummary = typeof BranchCommitSummary.Type;

export const InvalidBranchName = Schema.TaggedStruct("InvalidBranchName", {
  name: Schema.String.check(Schema.isMaxLength(1_024)),
});
export const BranchExists = Schema.TaggedStruct("BranchExists", {
  name: RefName,
});
export const BranchMoved = Schema.TaggedStruct("BranchMoved", {
  name: RefName,
});
export const BranchNotMerged = Schema.TaggedStruct("BranchNotMerged", {
  commits: Schema.Array(BranchCommitSummary).check(Schema.isMaxLength(20)),
  count: Schema.Natural,
  name: RefName,
});
export type BranchNotMerged = typeof BranchNotMerged.Type;

export const RepositoryBranchesOperationFailure = Schema.Union([
  RepositoryMissing,
  WorktreeMissing,
  RefMissing,
  BranchCheckedOutElsewhere,
  InvalidBranchName,
  BranchExists,
  BranchMoved,
  BranchNotMerged,
  GitFailed,
]);
export type RepositoryBranchesOperationFailure =
  typeof RepositoryBranchesOperationFailure.Type;

export const RepositoryBranchesHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  RepositoryBranchesOperationFailure,
]);
export type RepositoryBranchesHttpFailure =
  typeof RepositoryBranchesHttpFailure.Type;

const branchRoute = {
  capability: "repository.write",
  failure: RepositoryBranchesHttpFailure,
  failureStatuses: [404, 409, 422],
  method: "POST",
  successStatus: 200,
} as const;

export const RepositoryBranchesHttpApi = {
  create: {
    ...branchRoute,
    path: "/api/repositories/branches/create",
    request: CreateRepositoryBranch,
    success: LocalBranch,
  },
  delete: {
    ...branchRoute,
    path: "/api/repositories/branches/delete",
    request: DeleteRepositoryBranch,
    success: RepositoryBranchDeleted,
  },
  rename: {
    ...branchRoute,
    path: "/api/repositories/branches/rename",
    request: RenameRepositoryBranch,
    success: RepositoryBranchRenamed,
  },
  setUpstream: {
    ...branchRoute,
    path: "/api/repositories/branches/upstream",
    request: SetRepositoryBranchUpstream,
    success: LocalBranch,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
