import { z } from "zod";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const ReadFileBlame = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  path: RepositoryPath,
  revision: ObjectId.nullable(),
});
export type ReadFileBlame = z.infer<typeof ReadFileBlame>;

export const BlameRange = z.object({
  start: z.int(),
  count: z.int(),
  oid: ObjectId.nullable(),
  originalLine: z.int(),
});
export type BlameRange = z.infer<typeof BlameRange>;

export const BlameCommit = z.object({
  oid: ObjectId,
  subject: z.string().max(1_024),
  author: z.string().max(256),
  email: z.string().max(320),
  authoredAt: z.int(),
  path: RepositoryPath,
  previous: z.object({ oid: ObjectId, path: RepositoryPath }).nullable(),
});
export type BlameCommit = z.infer<typeof BlameCommit>;

export const FileBlame = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("Blamed"),
    text: z.string(),
    ranges: z.array(BlameRange).readonly(),
    commits: z.array(BlameCommit).readonly(),
  }),
  z.object({
    _tag: z.literal("Unblamable"),
    reason: z.enum(["binary", "large"]),
  }),
]);
export type FileBlame = z.infer<typeof FileBlame>;

export const FileBlameApi = {
  read: repositoryQuery("repositories/files/blame", {
    request: ReadFileBlame,
    success: FileBlame,
  }),
};
