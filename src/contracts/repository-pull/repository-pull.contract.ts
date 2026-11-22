import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import { RepositoryOperation } from "#contracts/repository-operations/repository-operations.contract.ts";

const RefName = z.string().min(1).max(1_024);

export const DivergedPull = z.enum(["rebase", "merge"]);
export type DivergedPull = z.infer<typeof DivergedPull>;

export const PullBranch = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
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

export const FetchPruneFailed = z.object({
  _tag: z.literal("FetchPruneFailed"),
  detail: z.string().max(2_048),
});
export type FetchPruneFailed = z.infer<typeof FetchPruneFailed>;

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
  readFetchPrune: route("fetch-prune/read", {
    success: z.boolean(),
    failure: FetchPruneFailed,
  }),
  saveFetchPrune: route("fetch-prune/save", {
    request: z.object({ prune: z.boolean() }),
    success: z.boolean(),
    failure: FetchPruneFailed,
  }),
  readRepositoryFetchPrune: repositoryQuery("repositories/fetch-prune", {
    request: RepositoryTarget,
    success: FetchPrune,
  }),
  saveRepositoryFetchPrune: repositoryCommand("repositories/save-fetch-prune", {
    request: z.object({
      repositoryId: RepositoryId,
      prune: z.boolean().nullable(),
    }),
    success: FetchPrune,
  }),
  pull: repositoryCommand("repositories/pull", {
    request: PullBranch,
    success: BranchPulled,
    failure: PullFailure,
  }),
  readPullStrategy: route("pull-strategy/read", {
    success: PullStrategy,
  }),
  savePullStrategy: route("pull-strategy/save", {
    request: z.object({ strategy: PullStrategy }),
    success: PullStrategy,
  }),
  readRepositoryPullStrategy: repositoryQuery("repositories/pull-strategy", {
    request: RepositoryTarget,
    success: RepositoryPullStrategy,
  }),
  saveRepositoryPullStrategy: repositoryCommand(
    "repositories/save-pull-strategy",
    {
      request: z.object({
        repositoryId: RepositoryId,
        strategy: PullStrategy.nullable(),
      }),
      success: RepositoryPullStrategy,
    },
  ),
};
