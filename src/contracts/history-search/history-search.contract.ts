import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const maximumCodeMatches = 1_000;

export const SearchCode = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  text: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
    Schema.isPattern(/^[^\n\r\0]+$/),
  ),
  path: Schema.optionalKey(RepositoryPath),
  roots: Schema.Array(ObjectId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(40_512),
  ),
});
export type SearchCode = typeof SearchCode.Type;

export const CodeMatch = Schema.Struct({
  oid: ObjectId,
  paths: Schema.Array(RepositoryPath).check(Schema.isMaxLength(10_000)),
});
export type CodeMatch = typeof CodeMatch.Type;

export const CodeSearchUpdate = Schema.Union([
  Schema.TaggedStruct("CodeMatches", {
    matches: Schema.Array(CodeMatch).check(Schema.isMaxLength(256)),
  }),
  Schema.TaggedStruct("CodeSearchProgress", {
    percent: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  }),
]);
export type CodeSearchUpdate = typeof CodeSearchUpdate.Type;

export const HistorySearchApi = {
  code: Rpc.make("repositories/history/code-search", {
    payload: SearchCode,
    success: CodeSearchUpdate,
    error: RepositoryRejected,
    stream: true,
  }),
};
