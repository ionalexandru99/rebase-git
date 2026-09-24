import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

export const OperationScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});
export type OperationScope = typeof OperationScope.Type;
export const OperationAction = Schema.Literals(["continue", "skip", "abort"]);
export type OperationAction = typeof OperationAction.Type;
export const OperationKind = Schema.Literals([
  "idle",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
  "unknown",
]);
export type OperationKind = typeof OperationKind.Type;
export const RepositoryOperation = Schema.Struct({
  kind: OperationKind,
  phase: Schema.Literals(["idle", "conflicts", "edit", "ready", "blocked"]),
  revision: Schema.String,
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  progress: Schema.NullOr(
    Schema.Struct({ current: Schema.Natural, total: Schema.Natural }),
  ),
  unresolvedPaths: Schema.Array(Schema.String),
  actions: Schema.Array(
    Schema.Struct({
      action: OperationAction,
      enabled: Schema.Boolean,
      reason: Schema.NullOr(Schema.String),
    }),
  ),
  lock: Schema.NullOr(Schema.String),
});
export type RepositoryOperation = typeof RepositoryOperation.Type;
export const ExecuteOperation = Schema.Struct({
  ...OperationScope.fields,
  revision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  action: OperationAction,
});
export type ExecuteOperation = typeof ExecuteOperation.Type;
export const OperationFailure = Schema.TaggedStruct("OperationFailed", {
  reason: Schema.Literals([
    "Missing",
    "Stale",
    "Incompatible",
    "Locked",
    "HookFailed",
    "GitRejected",
    "Uncertain",
    "InspectionFailed",
  ]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
});
export type OperationFailure = typeof OperationFailure.Type;
export const OperationsHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  OperationFailure,
]);
export const RepositoryOperationsHttpApi = {
  read: {
    capability: "repository.read",
    failure: OperationsHttpFailure,
    failureStatuses: [404, 409],
    method: "POST",
    path: "/api/repositories/operations/read",
    request: OperationScope,
    success: RepositoryOperation,
    successStatus: 200,
  },
  execute: {
    capability: "repository.write",
    failure: OperationsHttpFailure,
    failureStatuses: [404, 409],
    method: "POST",
    path: "/api/repositories/operations/execute",
    request: ExecuteOperation,
    success: RepositoryOperation,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
