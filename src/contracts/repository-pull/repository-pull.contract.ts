import {
  type EnvironmentHttpRoute,
  repositoryCommand,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
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

export const RepositoryPullHttpApi = {
  pull: repositoryCommand("/api/repositories/pull", {
    request: PullBranch,
    success: BranchPulled,
    failure: PullFailure,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
