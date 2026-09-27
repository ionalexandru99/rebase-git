import {
  repositoryCommand,
  repositoryQuery,
} from "@rebase/contracts/environment-connection/environment-route.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

const RefName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1_024),
);

export const PullBranch = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
});
export type PullBranch = typeof PullBranch.Type;

export const BranchPulled = Schema.Struct({
  outcome: Schema.Literals(["UpToDate", "FastForwarded"]),
});
export type BranchPulled = typeof BranchPulled.Type;

export const PullFailure = Schema.Union([
  Schema.TaggedStruct("BranchMissing", {}),
  Schema.TaggedStruct("UpstreamMissing", {
    upstream: Schema.optional(RefName),
  }),
  Schema.TaggedStruct("PullDiverged", { upstream: RefName }),
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
};
