import { z } from "zod";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import {
  ChangedLines,
  ChangesFailure,
} from "#contracts/repository-changes/repository-changes.contract.ts";

export const fileHistoryPage = 100;
export const maximumFileHistory = 5_000;

export const ReadFileHistory = z.object({
  ...WorktreeScope.shape,
  path: RepositoryPath,
  limit: z.int().min(1).max(maximumFileHistory),
});
export type ReadFileHistory = z.infer<typeof ReadFileHistory>;

export const FileHistoryEntry = z.object({
  oid: ObjectId,
  parentOid: ObjectId.nullable(),
  subject: z.string().max(1_024),
  author: z.string().max(256),
  authoredAt: z.int(),
  path: RepositoryPath,
  previousPath: RepositoryPath.nullable(),
  status: z.enum(["A", "M", "D", "R", "T"]),
  lines: ChangedLines,
});
export type FileHistoryEntry = z.infer<typeof FileHistoryEntry>;

export const FileHistory = z.object({
  entries: z.array(FileHistoryEntry).max(maximumFileHistory).readonly(),
  complete: z.boolean(),
});
export type FileHistory = z.infer<typeof FileHistory>;

export const FileHistoryApi = {
  read: repositoryQuery("repositories/files/history", {
    request: ReadFileHistory,
    success: FileHistory,
    failure: ChangesFailure,
  }),
};
