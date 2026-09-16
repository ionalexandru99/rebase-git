import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { Schema } from "effect";

export const OperationScope = Schema.Struct({
  repositoryId: Schema.String.check(Schema.isUUID(4)),
  worktreePath: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(4096),
  ),
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
export const OperationInvalidation = Schema.Struct({
  status: Schema.Boolean,
  refs: Schema.Boolean,
  history: Schema.Boolean,
});
export type OperationInvalidation = typeof OperationInvalidation.Type;
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
    "Unauthorized",
  ]),
  detail: Schema.String,
  invalidation: OperationInvalidation,
});
export type OperationFailure = typeof OperationFailure.Type;
export const OperationResult = Schema.Struct({
  operation: RepositoryOperation,
  invalidation: OperationInvalidation,
});
export type OperationResult = typeof OperationResult.Type;
export const OperationsHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  OperationFailure,
]);
export const RepositoryOperationsHttpApi = {
  read: {
    path: "/api/repositories/operations/read",
    request: OperationScope,
    success: RepositoryOperation,
  },
  execute: {
    path: "/api/repositories/operations/execute",
    request: ExecuteOperation,
    success: OperationResult,
  },
} as const;
