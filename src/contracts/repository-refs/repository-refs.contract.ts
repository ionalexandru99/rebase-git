import { z } from "zod";
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

export const RepositoryHead = z.object({
  branch: RefName.optional(),
  commit: ObjectId,
});
export type RepositoryHead = z.infer<typeof RepositoryHead>;

export const RepositoryWorktree = z.object({
  head: RepositoryHead,
  main: z.boolean(),
  path: RepositoryPath,
  locked: z.string().max(1_024).exactOptional(),
  missing: z.boolean().exactOptional(),
});
export type RepositoryWorktree = z.infer<typeof RepositoryWorktree>;

export const BranchUpstream = z.object({
  ahead: z.int().nonnegative(),
  behind: z.int().nonnegative(),
  gone: z.boolean(),
  name: RefName,
});
export type BranchUpstream = z.infer<typeof BranchUpstream>;

export const LocalBranch = z.object({
  name: RefName,
  settled: SettledDay.optional(),
  target: ObjectId.optional(),
  upstream: BranchUpstream.optional(),
  worktreePath: RepositoryPath.optional(),
});
export type LocalBranch = z.infer<typeof LocalBranch>;

export const RemoteBranch = z.object({
  name: RefName,
  remote: RemoteName,
  target: ObjectId.optional(),
});
export type RemoteBranch = z.infer<typeof RemoteBranch>;

export const RemoteDefaultBranch = z.object({
  name: RefName,
  remote: RemoteName,
});
export type RemoteDefaultBranch = z.infer<typeof RemoteDefaultBranch>;

export const RepositoryTag = z.object({
  name: RefName,
  target: ObjectId.optional(),
  object: ObjectId.optional(),
});
export type RepositoryTag = z.infer<typeof RepositoryTag>;

export const RepositoryRefsTruncation = z.object({
  branches: z.boolean(),
  remoteBranches: z.boolean(),
  tags: z.boolean(),
});
export type RepositoryRefsTruncation = z.infer<typeof RepositoryRefsTruncation>;

export const RepositoryRefs = z.object({
  remoteProviders: z
    .array(
      z.object({
        remote: RemoteName,
        provider: z.enum([
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
    )
    .max(256)
    .readonly()
    .exactOptional(),
  branches: z.array(LocalBranch).max(10_000).readonly(),
  logicalRepositoryId: RepositoryId.exactOptional(),
  remoteBranches: z.array(RemoteBranch).max(20_000).readonly(),
  remoteDefaultBranches: z
    .array(RemoteDefaultBranch)
    .max(256)
    .readonly()
    .exactOptional(),
  repositoryId: RepositoryId,
  tags: z.array(RepositoryTag).max(10_000).readonly(),
  truncated: RepositoryRefsTruncation,
  worktrees: z.array(RepositoryWorktree).max(256).readonly(),
});
export type RepositoryRefs = z.infer<typeof RepositoryRefs>;

export const RepositoryRefTarget = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("LocalBranch"), name: RefName }),
  z.object({
    _tag: z.literal("RemoteBranch"),
    name: RefName,
    remote: RemoteName,
  }),
  z.object({ _tag: z.literal("Tag"), name: RefName }),
]);
export type RepositoryRefTarget = z.infer<typeof RepositoryRefTarget>;

export const CheckoutRepositoryRef = z.object({
  repositoryId: RepositoryId,
  target: RepositoryRefTarget,
  worktreePath: RepositoryPath,
});
export type CheckoutRepositoryRef = z.infer<typeof CheckoutRepositoryRef>;

export const RepositoryCheckedOut = z.object({
  head: RepositoryHead,
  stash: z.enum(["none", "restored", "kept"]),
  worktreePath: RepositoryPath,
});
export type RepositoryCheckedOut = z.infer<typeof RepositoryCheckedOut>;

export const RefMissing = z.object({
  _tag: z.literal("RefMissing"),
  name: RefName,
});
export type RefMissing = z.infer<typeof RefMissing>;
export const BranchCheckedOutElsewhere = z.object({
  _tag: z.literal("BranchCheckedOutElsewhere"),
  name: RefName,
  worktreePath: RepositoryPath,
});
export const CheckoutRejected = z.object({
  _tag: z.literal("CheckoutRejected"),
  reason: z.enum(["LocalChanges", "StashFailed"]),
});

export const RepositoryCheckoutFailure = z.discriminatedUnion("_tag", [
  RefMissing,
  BranchCheckedOutElsewhere,
  CheckoutRejected,
]);
export type RepositoryCheckoutFailure = z.infer<
  typeof RepositoryCheckoutFailure
>;

export const ReadRepositoryRefs = z.object({
  repositoryId: RepositoryId,
});
export type ReadRepositoryRefs = z.infer<typeof ReadRepositoryRefs>;

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
