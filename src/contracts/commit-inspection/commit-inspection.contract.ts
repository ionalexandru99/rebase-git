import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import {
  ChangedLines,
  ChangesFailure,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";

const Fingerprint = z.string().max(128);
export const maximumRestorePaths = 1000;

export const InspectCommit = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  oid: ObjectId,
  parentOid: ObjectId.optional(),
});
export type InspectCommit = z.infer<typeof InspectCommit>;
export const InspectCommitDiff = z.object({
  ...InspectCommit.shape,
  path: RepositoryPath,
  previousPath: RepositoryPath.optional(),
  whole: z.boolean().optional(),
});
export type InspectCommitDiff = z.infer<typeof InspectCommitDiff>;
const CommitIdentity = z.object({
  name: z.string(),
  email: z.string(),
  date: z.string(),
});
export const CommitFile = z.object({
  path: RepositoryPath,
  previousPath: RepositoryPath.nullable(),
  status: z.enum(["A", "M", "D", "R", "T"]),
  lines: ChangedLines,
  lfs: z.boolean(),
});
export type CommitFile = z.infer<typeof CommitFile>;
export const CommitInspection = z.object({
  oid: ObjectId,
  message: z.string(),
  author: CommitIdentity,
  committer: CommitIdentity,
  parents: z.array(ObjectId).readonly(),
  parentOid: ObjectId.nullable(),
  files: z.array(CommitFile).readonly(),
  truncated: z.boolean(),
});
export type CommitInspection = z.infer<typeof CommitInspection>;
export const RestoreSource = z.enum(["commit", "parent"]);
export type RestoreSource = z.infer<typeof RestoreSource>;
export const PreviewRestore = z.object({
  ...InspectCommit.shape,
  source: RestoreSource,
  path: RepositoryPath,
  whole: z.boolean().optional(),
});
export type PreviewRestore = z.infer<typeof PreviewRestore>;
export const RestoreFiles = z.object({
  ...InspectCommit.shape,
  source: RestoreSource,
  paths: z.array(RepositoryPath).min(1).max(maximumRestorePaths).readonly(),
  overwrite: Fingerprint.optional(),
});
export type RestoreFiles = z.infer<typeof RestoreFiles>;
export const RestoreOverwrites = z.object({
  _tag: z.literal("RestoreOverwrites"),
  paths: z.array(RepositoryPath).max(20).readonly(),
  count: z.int().nonnegative(),
  fingerprint: Fingerprint,
});
export type RestoreOverwrites = z.infer<typeof RestoreOverwrites>;
export const CommitInspectionApi = {
  inspect: repositoryQuery("repositories/commits/inspect", {
    request: InspectCommit,
    success: CommitInspection,
    failure: ChangesFailure,
  }),
  inspectDiff: repositoryQuery("repositories/commits/diff", {
    request: InspectCommitDiff,
    success: ChangeDiff,
    failure: ChangesFailure,
  }),
  previewRestore: repositoryQuery("repositories/commits/restore-preview", {
    request: PreviewRestore,
    success: ChangeDiff,
    failure: ChangesFailure,
  }),
  restore: repositoryCommand("repositories/commits/restore", {
    request: RestoreFiles,
    success: z.void(),
    failure: z.discriminatedUnion("_tag", [ChangesFailure, RestoreOverwrites]),
  }),
};
