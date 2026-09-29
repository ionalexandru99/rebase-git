import { Schema } from "effect";
import { repositoryCommand } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import {
  BranchCheckedOutElsewhere,
  LocalBranch,
  RefMissing,
} from "#contracts/repository-refs/repository-refs.contract.ts";

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
  RefMissing,
  BranchCheckedOutElsewhere,
  InvalidBranchName,
  BranchExists,
  BranchMoved,
  BranchNotMerged,
]);
export type RepositoryBranchesOperationFailure =
  typeof RepositoryBranchesOperationFailure.Type;

export const RepositoryBranchesApi = {
  create: repositoryCommand("repositories/branches/create", {
    request: CreateRepositoryBranch,
    success: LocalBranch,
    failure: RepositoryBranchesOperationFailure,
  }),
  delete: repositoryCommand("repositories/branches/delete", {
    request: DeleteRepositoryBranch,
    success: RepositoryBranchDeleted,
    failure: RepositoryBranchesOperationFailure,
  }),
  rename: repositoryCommand("repositories/branches/rename", {
    request: RenameRepositoryBranch,
    success: RepositoryBranchRenamed,
    failure: RepositoryBranchesOperationFailure,
  }),
};
