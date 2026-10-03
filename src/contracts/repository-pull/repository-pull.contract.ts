import { Schema } from "effect";
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

const RefName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
);

export const DivergedPull = Schema.Literals(["rebase", "merge"]);
export type DivergedPull = typeof DivergedPull.Type;

export const PullBranch = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
  strategy: Schema.optionalKey(
    Schema.Struct({ kind: DivergedPull, upstream: ObjectId }),
  ),
});
export type PullBranch = typeof PullBranch.Type;

export const BranchPulled = Schema.Union([
  Schema.Struct({
    outcome: Schema.Literals([
      "UpToDate",
      "FastForwarded",
      "Rebased",
      "Merged",
    ]),
    stashKept: Schema.Boolean,
  }),
  Schema.Struct({
    outcome: Schema.Literal("Stopped"),
    worktreePath: RepositoryPath,
    operation: RepositoryOperation,
  }),
]);
export type BranchPulled = typeof BranchPulled.Type;

export const PullFailure = Schema.Union([
  Schema.TaggedStruct("BranchMissing", {}),
  Schema.TaggedStruct("UpstreamMissing", {
    upstream: Schema.optional(RefName),
  }),
  Schema.TaggedStruct("PullDiverged", {
    upstream: RefName,
    upstreamCommit: ObjectId,
  }),
  Schema.TaggedStruct("UpstreamMoved", {}),
  Schema.TaggedStruct("PullWouldOverwrite", {
    paths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(100)),
  }),
  Schema.TaggedStruct("PullBlocked", {
    detail: Schema.String.check(Schema.isMaxLength(2_048)),
  }),
  Schema.TaggedStruct("PullUncertain", {}),
]);
export type PullFailure = typeof PullFailure.Type;

export const RepositoryFetchSetting = Schema.Union([
  Schema.TaggedStruct("Inherit", {}),
  Schema.TaggedStruct("Disabled", {}),
  Schema.TaggedStruct("Interval", {
    seconds: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 86_400 }),
    ),
  }),
]);
export type RepositoryFetchSetting = typeof RepositoryFetchSetting.Type;

export const FetchFailed = Schema.TaggedStruct("FetchFailed", {
  reason: Schema.Literals([
    "GitUnavailable",
    "Timeout",
    "OutputTooLarge",
    "Failed",
  ]),
});
export type FetchFailed = typeof FetchFailed.Type;

export const RepositoryFetchStatus = Schema.Struct({
  fetching: Schema.Boolean,
  defaultIntervalSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
  setting: RepositoryFetchSetting,
  failure: Schema.optionalKey(FetchFailed),
});
export type RepositoryFetchStatus = typeof RepositoryFetchStatus.Type;

export const PullStrategy = Schema.Literals(["ask", ...DivergedPull.literals]);
export type PullStrategy = typeof PullStrategy.Type;

export const RepositoryPullStrategy = Schema.Struct({
  repository: Schema.NullOr(PullStrategy),
  server: PullStrategy,
});
export type RepositoryPullStrategy = typeof RepositoryPullStrategy.Type;

const RepositoryTarget = Schema.Struct({ repositoryId: RepositoryId });

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
    request: Schema.Struct({
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
  readPullStrategy: route("pull-strategy/read", {
    success: PullStrategy,
  }),
  savePullStrategy: route("pull-strategy/save", {
    request: Schema.Struct({ strategy: PullStrategy }),
    success: PullStrategy,
  }),
  readRepositoryPullStrategy: repositoryQuery("repositories/pull-strategy", {
    request: RepositoryTarget,
    success: RepositoryPullStrategy,
  }),
  saveRepositoryPullStrategy: repositoryCommand(
    "repositories/save-pull-strategy",
    {
      request: Schema.Struct({
        repositoryId: RepositoryId,
        strategy: Schema.NullOr(PullStrategy),
      }),
      success: RepositoryPullStrategy,
    },
  ),
};
