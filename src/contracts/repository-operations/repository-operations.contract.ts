import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

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
  "squash",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
  "unknown",
]);
export type OperationKind = typeof OperationKind.Type;
export const RepositoryOperation = Schema.Struct({
  kind: OperationKind,
  phase: Schema.Literals([
    "idle",
    "conflicts",
    "edit",
    "ready",
    "empty",
    "blocked",
  ]),
  revision: Schema.String,
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  mergedBranch: Schema.NullOr(Schema.String),
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
export const MergeMode = Schema.Literals([
  "merge",
  "ff-only",
  "no-ff",
  "squash",
]);
export type MergeMode = typeof MergeMode.Type;
export const StartMerge = Schema.TaggedStruct("Merge", {
  source: Schema.Struct({ ref: Schema.NullOr(RefName), commit: ObjectId }),
  mode: MergeMode,
});
export type StartMerge = typeof StartMerge.Type;
export const StartRebase = Schema.TaggedStruct("Rebase", {
  onto: Schema.Struct({ ref: Schema.NullOr(RefName), commit: ObjectId }),
  stash: Schema.Boolean,
});
export type StartRebase = typeof StartRebase.Type;
export const StartRevert = Schema.TaggedStruct("Revert", {
  commits: Schema.Array(ObjectId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
  ),
  commit: Schema.Boolean,
});
export type StartRevert = typeof StartRevert.Type;
export const CherryPickResult = Schema.Literals(["commit", "stage"]);
export type CherryPickResult = typeof CherryPickResult.Type;
export const StartCherryPick = Schema.TaggedStruct("CherryPick", {
  commits: Schema.Array(ObjectId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000),
  ),
  mainline: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 64 })),
  ),
  result: CherryPickResult,
});
export type StartCherryPick = typeof StartCherryPick.Type;
export const StartOperation = Schema.Struct({
  ...OperationScope.fields,
  expectedHead: ObjectId,
  operation: Schema.Union([
    StartMerge,
    StartRebase,
    StartRevert,
    StartCherryPick,
  ]),
});
export type StartOperation = typeof StartOperation.Type;
export const OperationStarted = Schema.Struct({
  outcome: Schema.Literals([
    "UpToDate",
    "FastForwarded",
    "Committed",
    "Rebased",
    "Staged",
    "Stopped",
  ]),
  operation: RepositoryOperation,
});
export type OperationStarted = typeof OperationStarted.Type;
export const OperationFailure = Schema.TaggedStruct("OperationFailed", {
  reason: Schema.Literals([
    "Stale",
    "Incompatible",
    "HookFailed",
    "GitRejected",
    "Uncertain",
    "NotFastForward",
    "Unrelated",
    "WouldOverwrite",
    "Empty",
  ]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
  paths: Schema.optionalKey(
    Schema.Array(RepositoryPath).check(Schema.isMaxLength(100)),
  ),
});
export type OperationFailure = typeof OperationFailure.Type;
export const RepositoryOperationsApi = {
  read: repositoryQuery("repositories/operations/read", {
    request: OperationScope,
    success: RepositoryOperation,
  }),
  execute: repositoryCommand("repositories/operations/execute", {
    request: ExecuteOperation,
    success: RepositoryOperation,
    failure: OperationFailure,
  }),
  start: repositoryCommand("repositories/operations/start", {
    request: StartOperation,
    success: OperationStarted,
    failure: OperationFailure,
  }),
};
