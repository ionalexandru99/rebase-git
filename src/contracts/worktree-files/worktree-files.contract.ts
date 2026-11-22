import { z } from "zod";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const maximumFolderEntries = 20_000;
export const maximumSearchResults = 200;
export const maximumFileBytes = 1_048_576;

const WorktreeScope = {
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
};

const RelativePath = z.string().max(4_096);

export const ListWorktreeFolder = z.object({
  ...WorktreeScope,
  folder: RelativePath,
});
export type ListWorktreeFolder = z.infer<typeof ListWorktreeFolder>;

export const WorktreeEntry = z.object({
  name: z.string().min(1).max(1_024),
  kind: z.enum(["file", "folder", "symlink", "submodule"]),
  ignored: z.boolean(),
});
export type WorktreeEntry = z.infer<typeof WorktreeEntry>;

export const WorktreeFolder = z.object({
  entries: z.array(WorktreeEntry).max(maximumFolderEntries).readonly(),
  complete: z.boolean(),
});
export type WorktreeFolder = z.infer<typeof WorktreeFolder>;

export const ReadWorktreeFile = z.object({
  ...WorktreeScope,
  path: RepositoryPath,
});
export type ReadWorktreeFile = z.infer<typeof ReadWorktreeFile>;

export const WorktreeFile = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("Text"),
    contents: z.string(),
    bytes: z.int(),
    truncated: z.boolean(),
  }),
  z.object({ _tag: z.literal("Binary"), bytes: z.int() }),
  z.object({ _tag: z.literal("Symlink"), target: z.string().max(4_096) }),
  z.object({ _tag: z.literal("Submodule"), oid: ObjectId.nullable() }),
  z.object({ _tag: z.literal("Missing") }),
]);
export type WorktreeFile = z.infer<typeof WorktreeFile>;

export const SearchWorktree = z.object({
  ...WorktreeScope,
  query: z.string().min(1).max(256),
});
export type SearchWorktree = z.infer<typeof SearchWorktree>;

export const WorktreeNameMatches = z.object({
  paths: z.array(RepositoryPath).max(maximumSearchResults).readonly(),
  complete: z.boolean(),
});
export type WorktreeNameMatches = z.infer<typeof WorktreeNameMatches>;

export const WorktreeTextMatch = z.object({
  path: RepositoryPath,
  line: z.int(),
  text: z.string().max(512),
});
export type WorktreeTextMatch = z.infer<typeof WorktreeTextMatch>;

export const WorktreeTextMatches = z.object({
  matches: z.array(WorktreeTextMatch).max(maximumSearchResults).readonly(),
  complete: z.boolean(),
});
export type WorktreeTextMatches = z.infer<typeof WorktreeTextMatches>;

export const WorktreeFilesApi = {
  list: repositoryQuery("repositories/worktree-files/list", {
    request: ListWorktreeFolder,
    success: WorktreeFolder,
  }),
  read: repositoryQuery("repositories/worktree-files/read", {
    request: ReadWorktreeFile,
    success: WorktreeFile,
  }),
  searchNames: repositoryQuery("repositories/worktree-files/search-names", {
    request: SearchWorktree,
    success: WorktreeNameMatches,
  }),
  searchText: repositoryQuery("repositories/worktree-files/search-text", {
    request: SearchWorktree,
    success: WorktreeTextMatches,
  }),
};
