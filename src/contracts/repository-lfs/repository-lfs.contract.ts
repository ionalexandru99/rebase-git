import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

const LfsScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});

export const LfsPattern = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
  Schema.isPattern(/^[^-\s][^\n\r]*$/),
);
export type LfsPattern = typeof LfsPattern.Type;

export const LargeFiles = Schema.Struct({
  installed: Schema.Boolean,
  patterns: Schema.Array(LfsPattern).check(Schema.isMaxLength(1_000)),
});
export type LargeFiles = typeof LargeFiles.Type;

export const LfsLock = Schema.Struct({
  path: RepositoryPath,
  owner: Schema.String.check(Schema.isMaxLength(256)),
  ours: Schema.Boolean,
});
export type LfsLock = typeof LfsLock.Type;

export const LfsLocks = Schema.Array(LfsLock).check(Schema.isMaxLength(10_000));
export type LfsLocks = typeof LfsLocks.Type;

export const SetTracked = Schema.Struct({
  ...LfsScope.fields,
  pattern: LfsPattern,
  tracked: Schema.Boolean,
});
export type SetTracked = typeof SetTracked.Type;

export const DownloadLargeFiles = Schema.Struct({
  ...LfsScope.fields,
  paths: Schema.Array(RepositoryPath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000),
  ),
  commits: Schema.optional(Schema.Array(ObjectId).check(Schema.isMaxLength(2))),
});
export type DownloadLargeFiles = typeof DownloadLargeFiles.Type;

export const LockAction = Schema.Literals(["Lock", "Unlock", "ForceUnlock"]);
export type LockAction = typeof LockAction.Type;

export const SetLock = Schema.Struct({
  ...LfsScope.fields,
  path: RepositoryPath,
  action: LockAction,
});
export type SetLock = typeof SetLock.Type;

export const RepositoryLfsApi = {
  read: repositoryQuery("repositories/lfs/read", {
    request: LfsScope,
    success: LargeFiles,
  }),
  locks: repositoryQuery("repositories/lfs/locks", {
    request: LfsScope,
    success: LfsLocks,
  }),
  setTracked: repositoryCommand("repositories/lfs/set-tracked", {
    request: SetTracked,
    success: Schema.Void,
  }),
  download: repositoryCommand("repositories/lfs/download", {
    request: DownloadLargeFiles,
    success: Schema.Void,
  }),
  setLock: repositoryCommand("repositories/lfs/set-lock", {
    request: SetLock,
    success: Schema.Void,
  }),
};
