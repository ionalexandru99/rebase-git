import { Schema } from "effect";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const ReadFileBlame = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  path: RepositoryPath,
  revision: Schema.NullOr(ObjectId),
});
export type ReadFileBlame = typeof ReadFileBlame.Type;

export const BlameRange = Schema.Struct({
  start: Schema.Int,
  count: Schema.Int,
  oid: Schema.NullOr(ObjectId),
  originalLine: Schema.Int,
});
export type BlameRange = typeof BlameRange.Type;

export const BlameCommit = Schema.Struct({
  oid: ObjectId,
  subject: Schema.String.check(Schema.isMaxLength(1_024)),
  author: Schema.String.check(Schema.isMaxLength(256)),
  email: Schema.String.check(Schema.isMaxLength(320)),
  authoredAt: Schema.Int,
  path: RepositoryPath,
  previous: Schema.NullOr(
    Schema.Struct({ oid: ObjectId, path: RepositoryPath }),
  ),
});
export type BlameCommit = typeof BlameCommit.Type;

export const FileBlame = Schema.Union([
  Schema.TaggedStruct("Blamed", {
    text: Schema.String,
    ranges: Schema.Array(BlameRange),
    commits: Schema.Array(BlameCommit),
  }),
  Schema.TaggedStruct("Unblamable", {
    reason: Schema.Literals(["binary", "large"]),
  }),
]);
export type FileBlame = typeof FileBlame.Type;

export const FileBlameApi = {
  read: repositoryQuery("repositories/files/blame", {
    request: ReadFileBlame,
    success: FileBlame,
  }),
};
