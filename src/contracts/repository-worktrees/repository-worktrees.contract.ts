import { z } from "zod";
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

const WorktreeScope = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});

export const WorktreeChanges = z.object({
  path: RepositoryPath,
  unstaged: z.int().nonnegative(),
  staged: z.int().nonnegative(),
});
export type WorktreeChanges = z.infer<typeof WorktreeChanges>;

export const RepositoryWorktreeStatus = z.object({
  worktrees: z.array(WorktreeChanges).max(256).readonly(),
});
export type RepositoryWorktreeStatus = z.infer<typeof RepositoryWorktreeStatus>;

export const WorktreeFolder = z.object({
  folder: RepositoryPath,
  configured: z.boolean(),
  separator: z.enum(["/", "\\"]),
});
export type WorktreeFolder = z.infer<typeof WorktreeFolder>;

export const WorktreeStart = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Branch"), name: RefName }),
  z.object({
    _tag: z.literal("NewBranch"),
    name: RefName,
    startPoint: ObjectId,
    track: BranchUpstreamTarget.optional(),
  }),
]);
export type WorktreeStart = z.infer<typeof WorktreeStart>;

export const CreateWorktree = z.object({
  ...WorktreeScope.shape,
  path: RepositoryPath,
  start: WorktreeStart,
});
export type CreateWorktree = z.infer<typeof CreateWorktree>;

export const WorktreeTarget = z.object({
  ...WorktreeScope.shape,
  target: RepositoryPath,
});
export type WorktreeTarget = z.infer<typeof WorktreeTarget>;

export const RemoveWorktree = z.object({
  ...WorktreeTarget.shape,
  changes: z.int().nonnegative(),
});
export type RemoveWorktree = z.infer<typeof RemoveWorktree>;

export const SetWorktreeFolder = z.object({
  ...WorktreeScope.shape,
  folder: RepositoryPath.nullable(),
});
export type SetWorktreeFolder = z.infer<typeof SetWorktreeFolder>;

export const WorktreeRejected = z.object({
  _tag: z.literal("WorktreeRejected"),
  reason: z.enum([
    "FolderExists",
    "NotAbsolute",
    "Locked",
    "Main",
    "Current",
    "Unsaved",
  ]),
});
export type WorktreeRejected = z.infer<typeof WorktreeRejected>;

export const WorktreeChanged = z.object({
  _tag: z.literal("WorktreeChanged"),
  changes: z.int().nonnegative(),
});
export type WorktreeChanged = z.infer<typeof WorktreeChanged>;

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
    success: z.object({ worktreePath: RepositoryPath }),
    failure: z.discriminatedUnion("_tag", [
      WorktreeRejected,
      RepositoryBranchesOperationFailure,
    ]),
  }),
  remove: repositoryCommand("repositories/worktrees/remove", {
    request: RemoveWorktree,
    success: z.object({}),
    failure: z.discriminatedUnion("_tag", [WorktreeRejected, WorktreeChanged]),
  }),
  unlock: repositoryCommand("repositories/worktrees/unlock", {
    request: WorktreeTarget,
    success: z.object({}),
  }),
  setFolder: repositoryCommand("repositories/worktrees/set-folder", {
    request: SetWorktreeFolder,
    success: z.object({}),
    failure: WorktreeRejected,
  }),
};
