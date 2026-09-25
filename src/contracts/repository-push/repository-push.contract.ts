import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  ObjectId,
  RefName,
  RemoteName,
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

export const PushDestination = Schema.Struct({
  remote: RemoteName,
  branch: RefName,
});
export type PushDestination = typeof PushDestination.Type;

export const PushMode = Schema.Union([
  Schema.TaggedStruct("FastForward", {}),
  Schema.TaggedStruct("ForceWithLease", { expectedOid: ObjectId }),
]);
export type PushMode = typeof PushMode.Type;

export const PushBranch = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  branch: RefName,
  destination: PushDestination,
  setUpstream: Schema.Boolean,
  mode: PushMode,
});
export type PushBranch = typeof PushBranch.Type;

export const RemoteBranchUpdated = Schema.Struct({
  destination: PushDestination,
  target: ObjectId,
});
export type RemoteBranchUpdated = typeof RemoteBranchUpdated.Type;

export const PushRejectedReason = Schema.Literals([
  "Missing",
  "RemoteMissing",
  "InvalidBranch",
  "Busy",
  "NonFastForward",
  "LeaseRejected",
  "HookDeclined",
  "Authentication",
  "Network",
  "Uncertain",
  "Failed",
]);
export type PushRejectedReason = typeof PushRejectedReason.Type;

export const PushRejected = Schema.TaggedStruct("PushRejected", {
  reason: PushRejectedReason,
  detail: Schema.String.check(Schema.isMaxLength(2_048)),
});
export type PushRejected = typeof PushRejected.Type;

export const RepositoryPushHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  PushRejected,
]);

export const RepositoryPushHttpApi = {
  push: {
    capability: "repository.write",
    failure: RepositoryPushHttpFailure,
    failureStatuses: [404, 409, 422],
    method: "POST",
    path: "/api/repositories/push",
    request: PushBranch,
    success: RemoteBranchUpdated,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
