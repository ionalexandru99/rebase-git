import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import {
  BranchCheckedOutElsewhere,
  LocalBranch,
  RefMissing,
} from "#contracts/repository-refs/repository-refs.contract.ts";

export const BranchUpstreamTarget = z.object({
  name: RefName,
  remote: RemoteName,
});
export type BranchUpstreamTarget = z.infer<typeof BranchUpstreamTarget>;

export const CreateRepositoryBranch = z.object({
  ...WorktreeScope.shape,
  name: RefName,
  startPoint: ObjectId,
  track: BranchUpstreamTarget.optional(),
});
export type CreateRepositoryBranch = z.infer<typeof CreateRepositoryBranch>;

export const RenameRepositoryBranch = z.object({
  ...WorktreeScope.shape,
  expectedTarget: ObjectId.optional(),
  name: RefName,
  newName: RefName,
});
export type RenameRepositoryBranch = z.infer<typeof RenameRepositoryBranch>;

const DeletedLocalBranch = z.object({ name: RefName, target: ObjectId });
const DeletedRemoteBranch = z.object({
  name: RefName,
  remote: RemoteName,
  target: ObjectId,
});

export const BranchDeletion = z.object({
  local: DeletedLocalBranch.optional(),
  remote: DeletedRemoteBranch.optional(),
});
export type BranchDeletion = z.infer<typeof BranchDeletion>;

export const DeleteRepositoryBranches = z.object({
  ...WorktreeScope.shape,
  branches: z.array(BranchDeletion).min(1).max(1_000).readonly(),
  force: z.boolean(),
});
export type DeleteRepositoryBranches = z.infer<typeof DeleteRepositoryBranches>;

export const ReadUnmergedBranches = z.object({
  ...WorktreeScope.shape,
  branches: DeleteRepositoryBranches.shape.branches,
});
export type ReadUnmergedBranches = z.infer<typeof ReadUnmergedBranches>;

export const RepositoryBranchRenamed = z.object({
  branch: LocalBranch,
  previousName: RefName,
});
export type RepositoryBranchRenamed = z.infer<typeof RepositoryBranchRenamed>;

export const BranchCommitSummary = z.object({
  oid: ObjectId,
  subject: z.string().max(512),
});
export type BranchCommitSummary = z.infer<typeof BranchCommitSummary>;

export const InvalidBranchName = z.object({
  _tag: z.literal("InvalidBranchName"),
  name: z.string().max(1_024),
});
export const BranchExists = z.object({
  _tag: z.literal("BranchExists"),
  name: RefName,
});
export const BranchMoved = z.object({
  _tag: z.literal("BranchMoved"),
  name: RefName,
});
export const UnmergedBranch = z.object({
  branch: BranchDeletion,
  commits: z.array(BranchCommitSummary).max(20).readonly(),
  count: z.int().nonnegative(),
});
export type UnmergedBranch = z.infer<typeof UnmergedBranch>;

export const RepositoryBranchesOperationFailure = z.discriminatedUnion("_tag", [
  RefMissing,
  BranchCheckedOutElsewhere,
  InvalidBranchName,
  BranchExists,
  BranchMoved,
]);
export type RepositoryBranchesOperationFailure = z.infer<
  typeof RepositoryBranchesOperationFailure
>;

export const RepositoryBranchesDeleted = z.object({
  deleted: z.array(BranchDeletion).max(1_000).readonly(),
  unmerged: z.array(UnmergedBranch).max(1_000).readonly(),
  failure: z
    .union([RepositoryBranchesOperationFailure, RepositoryRejected])
    .optional(),
});
export type RepositoryBranchesDeleted = z.infer<
  typeof RepositoryBranchesDeleted
>;

export const RepositoryBranchesApi = {
  create: repositoryCommand("repositories/branches/create", {
    request: CreateRepositoryBranch,
    success: LocalBranch,
    failure: RepositoryBranchesOperationFailure,
  }),
  delete: repositoryCommand("repositories/branches/delete", {
    request: DeleteRepositoryBranches,
    success: RepositoryBranchesDeleted,
    failure: RepositoryBranchesOperationFailure,
  }),
  unmerged: repositoryQuery("repositories/branches/unmerged", {
    request: ReadUnmergedBranches,
    success: z.array(UnmergedBranch).max(1_000).readonly(),
  }),
  rename: repositoryCommand("repositories/branches/rename", {
    request: RenameRepositoryBranch,
    success: RepositoryBranchRenamed,
    failure: RepositoryBranchesOperationFailure,
  }),
};
