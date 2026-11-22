import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RepositoryId,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";
import { settingRoutes } from "#contracts/settings/setting-routes.contract.ts";

export const DivergedPull = z.enum(["rebase", "merge"]);
export type DivergedPull = z.infer<typeof DivergedPull>;

export const PullBranch = z.object({
  ...WorktreeScope.shape,
  branch: RefName,
  strategy: z
    .object({ kind: DivergedPull, upstream: ObjectId })
    .exactOptional(),
});
export type PullBranch = z.infer<typeof PullBranch>;

export const BranchPulled = z.union([
  z.object({
    outcome: z.enum(["UpToDate", "FastForwarded", "Rebased", "Merged"]),
    stashKept: z.boolean(),
    movedToStash: ObjectId.exactOptional(),
  }),
  z.object({
    outcome: z.literal("Stopped"),
    worktreePath: RepositoryPath,
    operation: RepositoryOperation,
  }),
]);
export type BranchPulled = z.infer<typeof BranchPulled>;

export const PullFailure = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("BranchMissing") }),
  z.object({
    _tag: z.literal("UpstreamMissing"),
    upstream: RefName.optional(),
  }),
  z.object({
    _tag: z.literal("PullDiverged"),
    upstream: RefName,
    upstreamCommit: ObjectId,
  }),
  z.object({ _tag: z.literal("UpstreamMoved") }),
  z.object({
    _tag: z.literal("PullWouldOverwrite"),
    paths: z.array(RepositoryPath).max(100).readonly(),
  }),
  z.object({ _tag: z.literal("PullBlocked"), detail: z.string().max(2_048) }),
  z.object({
    _tag: z.literal("PullStashKept"),
    stash: ObjectId,
    busy: z.boolean(),
  }),
]);
export type PullFailure = z.infer<typeof PullFailure>;

export const RepositoryFetchSetting = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Inherit") }),
  z.object({ _tag: z.literal("Disabled") }),
  z.object({
    _tag: z.literal("Interval"),
    seconds: z.int().min(1).max(86_400),
  }),
]);
export type RepositoryFetchSetting = z.infer<typeof RepositoryFetchSetting>;

export const FetchFailed = z.object({
  _tag: z.literal("FetchFailed"),
  reason: z.enum(["GitUnavailable", "Timeout", "OutputTooLarge", "Failed"]),
});
export type FetchFailed = z.infer<typeof FetchFailed>;

export const RepositoryFetchStatus = z.object({
  fetching: z.boolean(),
  defaultIntervalSeconds: z.int().gt(0),
  setting: RepositoryFetchSetting,
  failure: FetchFailed.exactOptional(),
});
export type RepositoryFetchStatus = z.infer<typeof RepositoryFetchStatus>;

export const FetchPrune = z.object({
  repository: z.boolean().nullable(),
  server: z.boolean(),
});
export type FetchPrune = z.infer<typeof FetchPrune>;

export const PullStrategy = z.enum(["ask", ...DivergedPull.options]);
export type PullStrategy = z.infer<typeof PullStrategy>;

export const RepositoryPullStrategy = z.object({
  repository: PullStrategy.nullable(),
  server: PullStrategy,
});
export type RepositoryPullStrategy = z.infer<typeof RepositoryPullStrategy>;

const RepositoryTarget = z.object({ repositoryId: RepositoryId });

export const RepositoryPullApi = {
  fetchStatus: repositoryQuery("repositories/fetch-status", {
    request: RepositoryTarget,
    success: RepositoryFetchStatus,
  }),
  fetch: repositoryCommand("repositories/fetch", {
    request: RepositoryTarget,
    success: RepositoryFetchStatus,
    failure: FetchFailed,
  }),
  configureFetch: repositoryCommand("repositories/configure-fetch", {
    request: z.object({
      repositoryId: RepositoryId,
      setting: RepositoryFetchSetting,
    }),
    success: RepositoryFetchStatus,
  }),
  pull: repositoryCommand("repositories/pull", {
    request: PullBranch,
    success: BranchPulled,
    failure: PullFailure,
  }),
};

export const FetchPruneApi = settingRoutes("fetch-prune", {
  value: z.boolean(),
  choice: z.boolean(),
  repository: FetchPrune,
});

export const PullStrategyApi = settingRoutes("pull-strategy", {
  value: PullStrategy,
  choice: PullStrategy,
  repository: RepositoryPullStrategy,
});
