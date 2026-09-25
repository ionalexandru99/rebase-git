import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  GitFailed,
  RepositoryMissing,
} from "@rebase/contracts/git/git-failures.contract";
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
  branch: RefName,
});
export type PullBranch = typeof PullBranch.Type;

export const BranchPulled = Schema.Struct({
  outcome: Schema.Literals(["UpToDate", "FastForwarded"]),
});
export type BranchPulled = typeof BranchPulled.Type;

export const PullFailure = Schema.Union([
  RepositoryMissing,
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
  GitFailed,
]);
export type PullFailure = typeof PullFailure.Type;

export const PullHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  PullFailure,
]);
export type PullHttpFailure = typeof PullHttpFailure.Type;

export const RepositoryPullHttpApi = {
  pull: {
    capability: "repository.write",
    failure: PullHttpFailure,
    failureStatuses: [404, 409, 422],
    method: "POST",
    path: "/api/repositories/pull",
    request: PullBranch,
    success: BranchPulled,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
