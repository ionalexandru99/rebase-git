import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";

export const OperationAction = z.enum(["continue", "skip", "abort"]);
export type OperationAction = z.infer<typeof OperationAction>;
export const OperationKind = z.enum([
  "idle",
  "merge",
  "squash",
  "rebase",
  "cherry-pick",
  "revert",
  "am",
  "unknown",
]);
export type OperationKind = z.infer<typeof OperationKind>;
export const PlanAction = z.enum([
  "pick",
  "reword",
  "edit",
  "squash",
  "fixup",
  "drop",
]);
export type PlanAction = z.infer<typeof PlanAction>;
export const PlanStep = z.object({
  commit: ObjectId,
  action: PlanAction,
  message: z.string().min(1).max(32000).nullable(),
});
export type PlanStep = z.infer<typeof PlanStep>;
export const RebaseStep = z.object({
  commit: ObjectId,
  action: PlanAction,
  subject: z.string(),
  done: z.boolean(),
});
export type RebaseStep = z.infer<typeof RebaseStep>;
export const RepositoryOperation = z.object({
  kind: OperationKind,
  phase: z.enum(["idle", "conflicts", "edit", "ready", "empty", "blocked"]),
  revision: z.string(),
  branch: z.string().nullable(),
  commit: z.string().nullable(),
  mergedBranch: z.string().nullable(),
  progress: z
    .object({ current: z.int().nonnegative(), total: z.int().nonnegative() })
    .nullable(),
  unresolvedPaths: z.array(z.string()).readonly(),
  actions: z
    .array(
      z.object({
        action: OperationAction,
        enabled: z.boolean(),
        reason: z.string().nullable(),
      }),
    )
    .readonly(),
  lock: z.string().nullable(),
  steps: z.array(RebaseStep).readonly().nullable(),
});
export type RepositoryOperation = z.infer<typeof RepositoryOperation>;
export const ExecuteOperation = z.object({
  ...WorktreeScope.shape,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  action: OperationAction,
});
export type ExecuteOperation = z.infer<typeof ExecuteOperation>;
export const MergeMode = z.enum(["merge", "ff-only", "no-ff", "squash"]);
export type MergeMode = z.infer<typeof MergeMode>;
export const StartMerge = z.object({
  _tag: z.literal("Merge"),
  source: z.object({ ref: RefName.nullable(), commit: ObjectId }),
  mode: MergeMode,
});
export type StartMerge = z.infer<typeof StartMerge>;
export const StartRebase = z.object({
  _tag: z.literal("Rebase"),
  onto: z.object({ ref: RefName.nullable(), commit: ObjectId }),
  stash: z.boolean(),
  plan: z.array(PlanStep).min(1).max(1_000).readonly().exactOptional(),
});
export type StartRebase = z.infer<typeof StartRebase>;
export const StartRevert = z.object({
  _tag: z.literal("Revert"),
  commits: z.array(ObjectId).min(1).max(256).readonly(),
  commit: z.boolean(),
});
export type StartRevert = z.infer<typeof StartRevert>;
export const CherryPickResult = z.enum(["commit", "stage"]);
export type CherryPickResult = z.infer<typeof CherryPickResult>;
export const StartCherryPick = z.object({
  _tag: z.literal("CherryPick"),
  commits: z.array(ObjectId).min(1).max(1_000).readonly(),
  mainline: z.int().min(1).max(64).nullable(),
  result: CherryPickResult,
});
export type StartCherryPick = z.infer<typeof StartCherryPick>;
export const StartOperation = z.object({
  ...WorktreeScope.shape,
  expectedHead: ObjectId,
  operation: z.discriminatedUnion("_tag", [
    StartMerge,
    StartRebase,
    StartRevert,
    StartCherryPick,
  ]),
});
export type StartOperation = z.infer<typeof StartOperation>;
export const OperationStarted = z.object({
  outcome: z.enum([
    "UpToDate",
    "FastForwarded",
    "Committed",
    "Rebased",
    "Staged",
    "Stopped",
  ]),
  operation: RepositoryOperation,
});
export type OperationStarted = z.infer<typeof OperationStarted>;
export const OperationFailure = z.object({
  _tag: z.literal("OperationFailed"),
  reason: z.enum([
    "Stale",
    "Incompatible",
    "HookFailed",
    "GitRejected",
    "NotFastForward",
    "Unrelated",
    "WouldOverwrite",
    "Empty",
  ]),
  detail: z.string().max(2048),
  paths: z.array(RepositoryPath).max(100).readonly().exactOptional(),
});
export type OperationFailure = z.infer<typeof OperationFailure>;
export const RepositoryOperationsApi = {
  read: repositoryQuery("repositories/operations/read", {
    request: WorktreeScope,
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
