import { Schema } from "effect";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import {
  ChangedLines,
  ChangesFailure,
} from "#contracts/repository-changes/repository-changes.contract.ts";

export const fileHistoryPage = 100;
export const maximumFileHistory = 5_000;

export const ReadFileHistory = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  path: RepositoryPath,
  limit: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: maximumFileHistory }),
  ),
});
export type ReadFileHistory = typeof ReadFileHistory.Type;

export const FileHistoryEntry = Schema.Struct({
  oid: ObjectId,
  parentOid: Schema.NullOr(ObjectId),
  subject: Schema.String.check(Schema.isMaxLength(1_024)),
  author: Schema.String.check(Schema.isMaxLength(256)),
  authoredAt: Schema.Int,
  path: RepositoryPath,
  previousPath: Schema.NullOr(RepositoryPath),
  status: Schema.Literals(["A", "M", "D", "R", "T"]),
  lines: ChangedLines,
});
export type FileHistoryEntry = typeof FileHistoryEntry.Type;

export const FileHistory = Schema.Struct({
  entries: Schema.Array(FileHistoryEntry).check(
    Schema.isMaxLength(maximumFileHistory),
  ),
  complete: Schema.Boolean,
});
export type FileHistory = typeof FileHistory.Type;

export const FileHistoryApi = {
  read: repositoryQuery("repositories/files/history", {
    request: ReadFileHistory,
    success: FileHistory,
    failure: ChangesFailure,
  }),
};
