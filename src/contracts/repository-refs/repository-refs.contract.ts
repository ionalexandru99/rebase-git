import { Schema } from "effect";
import { SettledDay } from "#contracts/branch-settling/branch-settling.contract.ts";
import {
  repositoryCommand,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const RepositoryHead = Schema.Struct({
  branch: Schema.optional(RefName),
  commit: ObjectId,
});
export type RepositoryHead = typeof RepositoryHead.Type;

export const RepositoryWorktree = Schema.Struct({
  head: RepositoryHead,
  main: Schema.Boolean,
  path: RepositoryPath,
  locked: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_024))),
  missing: Schema.optionalKey(Schema.Boolean),
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
  settled: Schema.optional(SettledDay),
  target: Schema.optional(ObjectId),
  upstream: Schema.optional(BranchUpstream),
  worktreePath: Schema.optional(RepositoryPath),
});
export type LocalBranch = typeof LocalBranch.Type;

export const RemoteBranch = Schema.Struct({
  name: RefName,
  remote: RemoteName,
  target: Schema.optional(ObjectId),
});
export type RemoteBranch = typeof RemoteBranch.Type;

export const RemoteDefaultBranch = Schema.Struct({
  name: RefName,
  remote: RemoteName,
});
export type RemoteDefaultBranch = typeof RemoteDefaultBranch.Type;

export const RepositoryTag = Schema.Struct({
  name: RefName,
  target: Schema.optional(ObjectId),
  object: Schema.optional(ObjectId),
});
export type RepositoryTag = typeof RepositoryTag.Type;

export const RepositoryRefsTruncation = Schema.Struct({
  branches: Schema.Boolean,
  remoteBranches: Schema.Boolean,
  tags: Schema.Boolean,
});
export type RepositoryRefsTruncation = typeof RepositoryRefsTruncation.Type;

const HostedName = Schema.String.check(
  Schema.isPattern(/^(?!\.{1,2}$)[\w.-]{1,100}$/),
);

export const RepositoryRefs = Schema.Struct({
  remoteProviders: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        remote: RemoteName,
        provider: Schema.Literals([
          "github",
          "gitlab",
          "bitbucket",
          "azure",
          "codeberg",
          "gitea",
          "forgejo",
          "aws",
          "git",
        ]),
      }),
    ).check(Schema.isMaxLength(256)),
  ),
  hostedRepository: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        provider: Schema.Literals(["github", "bitbucket", "codeberg"]),
        owner: HostedName,
        name: HostedName,
      }),
      Schema.Struct({ provider: Schema.Literals(["gitlab", "azure"]) }),
    ]),
  ),
  branches: Schema.Array(LocalBranch).check(Schema.isMaxLength(10_000)),
  logicalRepositoryId: Schema.optionalKey(RepositoryId),
  remoteBranches: Schema.Array(RemoteBranch).check(Schema.isMaxLength(20_000)),
  remoteDefaultBranches: Schema.optionalKey(
    Schema.Array(RemoteDefaultBranch).check(Schema.isMaxLength(256)),
  ),
  repositoryId: RepositoryId,
  tags: Schema.Array(RepositoryTag).check(Schema.isMaxLength(10_000)),
  truncated: RepositoryRefsTruncation,
  worktrees: Schema.Array(RepositoryWorktree).check(Schema.isMaxLength(256)),
});
export type RepositoryRefs = typeof RepositoryRefs.Type;

export const RepositoryRefTarget = Schema.Union([
  Schema.TaggedStruct("LocalBranch", { name: RefName }),
  Schema.TaggedStruct("RemoteBranch", { name: RefName, remote: RemoteName }),
  Schema.TaggedStruct("Tag", { name: RefName }),
]);
export type RepositoryRefTarget = typeof RepositoryRefTarget.Type;

export const CheckoutRepositoryRef = Schema.Struct({
  repositoryId: RepositoryId,
  target: RepositoryRefTarget,
  worktreePath: RepositoryPath,
});
export type CheckoutRepositoryRef = typeof CheckoutRepositoryRef.Type;

export const RepositoryCheckedOut = Schema.Struct({
  head: RepositoryHead,
  stash: Schema.Literals(["none", "restored", "kept"]),
  worktreePath: RepositoryPath,
});
export type RepositoryCheckedOut = typeof RepositoryCheckedOut.Type;

export const RefMissing = Schema.TaggedStruct("RefMissing", {
  name: RefName,
});
export type RefMissing = typeof RefMissing.Type;
export const BranchCheckedOutElsewhere = Schema.TaggedStruct(
  "BranchCheckedOutElsewhere",
  {
    name: RefName,
    worktreePath: RepositoryPath,
  },
);
export const CheckoutRejected = Schema.TaggedStruct("CheckoutRejected", {
  reason: Schema.Literals(["LocalChanges", "StashFailed"]),
});

export const RepositoryCheckoutFailure = Schema.Union([
  RefMissing,
  BranchCheckedOutElsewhere,
  CheckoutRejected,
]);
export type RepositoryCheckoutFailure = typeof RepositoryCheckoutFailure.Type;

export const ReadRepositoryRefs = Schema.Struct({
  repositoryId: RepositoryId,
});
export type ReadRepositoryRefs = typeof ReadRepositoryRefs.Type;

export const RepositoryRefsApi = {
  read: route("repositories/refs/read", {
    request: ReadRepositoryRefs,
    success: RepositoryRefs,
    failure: RepositoryRejected,
  }),
  checkout: repositoryCommand("repositories/refs/checkout", {
    request: CheckoutRepositoryRef,
    success: RepositoryCheckedOut,
    failure: RepositoryCheckoutFailure,
  }),
};
