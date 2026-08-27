import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { RepositoryMissing } from "@rebase/contracts/repository-catalog/repository-catalog.contract";
import { Schema } from "effect";

const RepositoryId = Schema.String.check(Schema.isUUID(4));
const RefName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
);
const RemoteName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);
const WorktreePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
);
const CommitId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
);
const FailureDetail = Schema.String.check(Schema.isMaxLength(2_048));

export const RepositoryHead = Schema.Struct({
  branch: Schema.optional(RefName),
  commit: CommitId,
});
export type RepositoryHead = typeof RepositoryHead.Type;

export const RepositoryWorktree = Schema.Struct({
  head: RepositoryHead,
  main: Schema.Boolean,
  path: WorktreePath,
});
export type RepositoryWorktree = typeof RepositoryWorktree.Type;

export const BranchUpstream = Schema.Struct({
  ahead: Schema.Natural,
  behind: Schema.Natural,
  gone: Schema.Boolean,
  name: RefName,
});
export type BranchUpstream = typeof BranchUpstream.Type;

export const LocalBranch = Schema.Struct({
  name: RefName,
  upstream: Schema.optional(BranchUpstream),
  worktreePath: Schema.optional(WorktreePath),
});
export type LocalBranch = typeof LocalBranch.Type;

export const RemoteBranch = Schema.Struct({
  name: RefName,
  remote: RemoteName,
});
export type RemoteBranch = typeof RemoteBranch.Type;

export const RepositoryTag = Schema.Struct({
  name: RefName,
});
export type RepositoryTag = typeof RepositoryTag.Type;

export const RepositoryRefsTruncation = Schema.Struct({
  branches: Schema.Boolean,
  remoteBranches: Schema.Boolean,
  tags: Schema.Boolean,
});
export type RepositoryRefsTruncation = typeof RepositoryRefsTruncation.Type;

export const RepositoryRefs = Schema.Struct({
  branches: Schema.Array(LocalBranch).check(Schema.isMaxLength(10_000)),
  remoteBranches: Schema.Array(RemoteBranch).check(Schema.isMaxLength(20_000)),
  repositoryId: RepositoryId,
  tags: Schema.Array(RepositoryTag).check(Schema.isMaxLength(10_000)),
  truncated: RepositoryRefsTruncation,
  worktrees: Schema.Array(RepositoryWorktree).check(Schema.isMaxLength(256)),
});
export type RepositoryRefs = typeof RepositoryRefs.Type;

export const ReadRepositoryRefs = Schema.Struct({
  repositoryId: RepositoryId,
});
export type ReadRepositoryRefs = typeof ReadRepositoryRefs.Type;

export const RepositoryRefTarget = Schema.Union([
  Schema.TaggedStruct("LocalBranch", { name: RefName }),
  Schema.TaggedStruct("RemoteBranch", { name: RefName, remote: RemoteName }),
  Schema.TaggedStruct("Tag", { name: RefName }),
]);
export type RepositoryRefTarget = typeof RepositoryRefTarget.Type;

export const CheckoutRepositoryRef = Schema.Struct({
  repositoryId: RepositoryId,
  target: RepositoryRefTarget,
  worktreePath: WorktreePath,
});
export type CheckoutRepositoryRef = typeof CheckoutRepositoryRef.Type;

export const RepositoryCheckedOut = Schema.Struct({
  head: RepositoryHead,
  stash: Schema.Literals(["none", "restored", "kept"]),
  worktreePath: WorktreePath,
});
export type RepositoryCheckedOut = typeof RepositoryCheckedOut.Type;

export const WorktreeMissing = Schema.TaggedStruct("WorktreeMissing", {
  worktreePath: WorktreePath,
});
export const RefMissing = Schema.TaggedStruct("RefMissing", {
  name: RefName,
});
export const BranchCheckedOutElsewhere = Schema.TaggedStruct(
  "BranchCheckedOutElsewhere",
  {
    name: RefName,
    worktreePath: WorktreePath,
  },
);
export const CheckoutRejected = Schema.TaggedStruct("CheckoutRejected", {
  detail: FailureDetail,
  reason: Schema.Literals(["LocalChanges", "StashFailed"]),
});
export const GitFailed = Schema.TaggedStruct("GitFailed", {
  detail: Schema.optional(FailureDetail),
  reason: Schema.Literals([
    "GitUnavailable",
    "NotRepository",
    "Timeout",
    "OutputTooLarge",
    "Failed",
  ]),
});

export const RepositoryRefsOperationFailure = Schema.Union([
  RepositoryMissing,
  WorktreeMissing,
  RefMissing,
  BranchCheckedOutElsewhere,
  CheckoutRejected,
  GitFailed,
]);
export type RepositoryRefsOperationFailure =
  typeof RepositoryRefsOperationFailure.Type;

export const RepositoryRefsHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  RepositoryRefsOperationFailure,
]);
export type RepositoryRefsHttpFailure = typeof RepositoryRefsHttpFailure.Type;

export const repositoryRefsPath = "/api/repositories/refs";
export const checkoutRepositoryRefPath = "/api/repositories/refs/checkout";

export const RepositoryRefsHttpApi = {
  checkout: {
    failure: RepositoryRefsHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413, 422] as const,
    method: "POST",
    path: checkoutRepositoryRefPath,
    request: CheckoutRepositoryRef,
    success: RepositoryCheckedOut,
    successStatus: 200,
  },
  read: {
    failure: RepositoryRefsHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422] as const,
    method: "GET",
    path: repositoryRefsPath,
    query: ReadRepositoryRefs,
    success: RepositoryRefs,
    successStatus: 200,
  },
} as const;
