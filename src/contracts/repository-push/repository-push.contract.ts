import { z } from "zod";
import { repositoryCommand } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const PushDestination = z.object({
  remote: RemoteName,
  branch: RefName,
});
export type PushDestination = z.infer<typeof PushDestination>;

export const PushMode = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("FastForward") }),
  z.object({ _tag: z.literal("ForceWithLease"), expectedOid: ObjectId }),
]);
export type PushMode = z.infer<typeof PushMode>;

export const PushBranch = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
  destination: PushDestination,
  setUpstream: z.boolean(),
  mode: PushMode,
});
export type PushBranch = z.infer<typeof PushBranch>;

export const RemoteBranchUpdated = z.object({
  destination: PushDestination,
  target: ObjectId,
});
export type RemoteBranchUpdated = z.infer<typeof RemoteBranchUpdated>;

export const PushTags = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  remote: RemoteName,
  tags: z.array(RefName).min(1).max(100).readonly(),
});
export type PushTags = z.infer<typeof PushTags>;

export const TagsPushed = z.object({
  remote: RemoteName,
  pushed: z.array(RefName).readonly(),
  upToDate: z.array(RefName).readonly(),
});
export type TagsPushed = z.infer<typeof TagsPushed>;

export const PushRejectedReason = z.enum([
  "RemoteMissing",
  "InvalidBranch",
  "TagExists",
  "NonFastForward",
  "LeaseRejected",
  "HookDeclined",
  "Authentication",
  "Network",
]);
export type PushRejectedReason = z.infer<typeof PushRejectedReason>;

export const PushRejected = z.object({
  _tag: z.literal("PushRejected"),
  reason: PushRejectedReason,
  detail: z.string().max(2_048),
});
export type PushRejected = z.infer<typeof PushRejected>;

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
