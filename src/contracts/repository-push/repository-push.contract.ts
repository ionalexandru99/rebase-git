import {
  type EnvironmentHttpRoute,
  repositoryCommand,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
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
  "RemoteMissing",
  "InvalidBranch",
  "NonFastForward",
  "LeaseRejected",
  "HookDeclined",
  "Authentication",
  "Network",
  "Uncertain",
]);
export type PushRejectedReason = typeof PushRejectedReason.Type;

export const PushRejected = Schema.TaggedStruct("PushRejected", {
  reason: PushRejectedReason,
  detail: Schema.String.check(Schema.isMaxLength(2_048)),
});
export type PushRejected = typeof PushRejected.Type;

export const RepositoryPushHttpApi = {
  push: repositoryCommand("/api/repositories/push", {
    request: PushBranch,
    success: RemoteBranchUpdated,
    failure: PushRejected,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
