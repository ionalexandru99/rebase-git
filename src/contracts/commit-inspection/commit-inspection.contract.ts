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
import { ChangesFailure } from "#contracts/repository-changes/repository-changes.contract.ts";
import { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";

const Fingerprint = Schema.String.check(Schema.isMaxLength(128));
export const maximumRestorePaths = 1000;

export const InspectCommit = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  oid: ObjectId,
  parentOid: Schema.optional(ObjectId),
});
export type InspectCommit = typeof InspectCommit.Type;
export const InspectCommitDiff = Schema.Struct({
  ...InspectCommit.fields,
  path: RepositoryPath,
  previousPath: Schema.optional(RepositoryPath),
});
export type InspectCommitDiff = typeof InspectCommitDiff.Type;
const CommitIdentity = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  date: Schema.String,
});
export const CommitFile = Schema.Struct({
  path: RepositoryPath,
  previousPath: Schema.NullOr(RepositoryPath),
  status: Schema.Literals(["A", "M", "D", "R", "T"]),
});
export type CommitFile = typeof CommitFile.Type;
export const CommitInspection = Schema.Struct({
  oid: ObjectId,
  message: Schema.String,
  author: CommitIdentity,
  committer: CommitIdentity,
  parents: Schema.Array(ObjectId),
  parentOid: Schema.NullOr(ObjectId),
  files: Schema.Array(CommitFile),
  truncated: Schema.Boolean,
});
export type CommitInspection = typeof CommitInspection.Type;
export const RestoreSource = Schema.Literals(["commit", "parent"]);
export type RestoreSource = typeof RestoreSource.Type;
export const PreviewRestore = Schema.Struct({
  ...InspectCommit.fields,
  source: RestoreSource,
  path: RepositoryPath,
});
export type PreviewRestore = typeof PreviewRestore.Type;
export const RestoreFiles = Schema.Struct({
  ...InspectCommit.fields,
  source: RestoreSource,
  paths: Schema.Array(RepositoryPath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maximumRestorePaths),
  ),
  overwrite: Schema.optional(Fingerprint),
});
export type RestoreFiles = typeof RestoreFiles.Type;
export const RestoreOverwrites = Schema.TaggedStruct("RestoreOverwrites", {
  paths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(20)),
  count: Schema.Natural,
  fingerprint: Fingerprint,
});
export type RestoreOverwrites = typeof RestoreOverwrites.Type;
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
    success: Schema.Void,
    failure: Schema.Union([ChangesFailure, RestoreOverwrites]),
  }),
};
