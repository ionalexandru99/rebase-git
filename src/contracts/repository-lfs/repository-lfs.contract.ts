import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";

export const LfsPattern = z
  .string()
  .min(1)
  .max(4_096)
  .regex(/^[^-\s][^\n\r]*$/);
export type LfsPattern = z.infer<typeof LfsPattern>;

export const LargeFiles = z.object({
  installed: z.boolean(),
  patterns: z.array(LfsPattern).max(1_000).readonly(),
});
export type LargeFiles = z.infer<typeof LargeFiles>;

export const LfsLock = z.object({
  path: RepositoryPath,
  owner: z.string().max(256),
  ours: z.boolean(),
});
export type LfsLock = z.infer<typeof LfsLock>;

export const LfsLocks = z.array(LfsLock).max(10_000).readonly();
export type LfsLocks = z.infer<typeof LfsLocks>;

export const SetTracked = z.object({
  ...WorktreeScope.shape,
  pattern: LfsPattern,
  tracked: z.boolean(),
});
export type SetTracked = z.infer<typeof SetTracked>;

export const DownloadLargeFiles = z.object({
  ...WorktreeScope.shape,
  paths: z.array(RepositoryPath).min(1).max(1_000).readonly(),
  commits: z.array(ObjectId).max(2).readonly().optional(),
});
export type DownloadLargeFiles = z.infer<typeof DownloadLargeFiles>;

export const LockAction = z.enum(["Lock", "Unlock", "ForceUnlock"]);
export type LockAction = z.infer<typeof LockAction>;

export const SetLock = z.object({
  ...WorktreeScope.shape,
  path: RepositoryPath,
  action: LockAction,
});
export type SetLock = z.infer<typeof SetLock>;

export const RepositoryLfsApi = {
  read: repositoryQuery("repositories/lfs/read", {
    request: WorktreeScope,
    success: LargeFiles,
  }),
  locks: repositoryQuery("repositories/lfs/locks", {
    request: WorktreeScope,
    success: LfsLocks,
  }),
  setTracked: repositoryCommand("repositories/lfs/set-tracked", {
    request: SetTracked,
    success: z.void(),
  }),
  download: repositoryCommand("repositories/lfs/download", {
    request: DownloadLargeFiles,
    success: z.void(),
  }),
  setLock: repositoryCommand("repositories/lfs/set-lock", {
    request: SetLock,
    success: z.void(),
  }),
};
