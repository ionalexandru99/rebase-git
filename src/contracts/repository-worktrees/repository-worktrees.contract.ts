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
import {
  BranchUpstreamTarget,
  RepositoryBranchesOperationFailure,
} from "#contracts/repository-refs/repository-branches.contract.ts";

const WorktreeScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});

export const WorktreeChanges = Schema.Struct({
  path: RepositoryPath,
  changes: Schema.Natural,
});
export type WorktreeChanges = typeof WorktreeChanges.Type;

export const RepositoryWorktreeStatus = Schema.Struct({
  worktrees: Schema.Array(WorktreeChanges).check(Schema.isMaxLength(256)),
});
export type RepositoryWorktreeStatus = typeof RepositoryWorktreeStatus.Type;

export const WorktreeFolder = Schema.Struct({
  folder: RepositoryPath,
  configured: Schema.Boolean,
  separator: Schema.Literals(["/", "\\"]),
});
export type WorktreeFolder = typeof WorktreeFolder.Type;

export const WorktreeStart = Schema.Union([
  Schema.TaggedStruct("Branch", { name: RefName }),
  Schema.TaggedStruct("NewBranch", {
    name: RefName,
    startPoint: ObjectId,
    track: Schema.optional(BranchUpstreamTarget),
  }),
]);
export type WorktreeStart = typeof WorktreeStart.Type;

export const CreateWorktree = Schema.Struct({
  ...WorktreeScope.fields,
  path: RepositoryPath,
  start: WorktreeStart,
});
export type CreateWorktree = typeof CreateWorktree.Type;

export const WorktreeTarget = Schema.Struct({
  ...WorktreeScope.fields,
  target: RepositoryPath,
});
export type WorktreeTarget = typeof WorktreeTarget.Type;

export const RemoveWorktree = Schema.Struct({
  ...WorktreeTarget.fields,
  changes: Schema.Natural,
});
export type RemoveWorktree = typeof RemoveWorktree.Type;

export const SetWorktreeFolder = Schema.Struct({
  ...WorktreeScope.fields,
  folder: Schema.NullOr(RepositoryPath),
});
export type SetWorktreeFolder = typeof SetWorktreeFolder.Type;

export const WorktreeRejected = Schema.TaggedStruct("WorktreeRejected", {
  reason: Schema.Literals([
    "FolderExists",
    "NotAbsolute",
    "Locked",
    "Main",
    "Current",
  ]),
});
export type WorktreeRejected = typeof WorktreeRejected.Type;

export const WorktreeChanged = Schema.TaggedStruct("WorktreeChanged", {
  changes: Schema.Natural,
});
export type WorktreeChanged = typeof WorktreeChanged.Type;

export const RepositoryWorktreesApi = {
  status: repositoryQuery("repositories/worktrees/status", {
    request: WorktreeScope,
    success: RepositoryWorktreeStatus,
  }),
  folder: repositoryQuery("repositories/worktrees/folder", {
    request: WorktreeScope,
    success: WorktreeFolder,
  }),
  create: repositoryCommand("repositories/worktrees/create", {
    request: CreateWorktree,
    success: Schema.Struct({ worktreePath: RepositoryPath }),
    failure: Schema.Union([
      WorktreeRejected,
      RepositoryBranchesOperationFailure,
    ]),
  }),
  remove: repositoryCommand("repositories/worktrees/remove", {
    request: RemoveWorktree,
    success: Schema.Struct({}),
    failure: Schema.Union([WorktreeRejected, WorktreeChanged]),
  }),
  unlock: repositoryCommand("repositories/worktrees/unlock", {
    request: WorktreeTarget,
    success: Schema.Struct({}),
  }),
  setFolder: repositoryCommand("repositories/worktrees/set-folder", {
    request: SetWorktreeFolder,
    success: Schema.Struct({}),
    failure: WorktreeRejected,
  }),
};
