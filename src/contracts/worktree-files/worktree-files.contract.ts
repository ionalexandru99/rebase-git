import { Schema } from "effect";
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

const RelativePath = Schema.String.check(Schema.isMaxLength(4_096));

export const ListWorktreeFolder = Schema.Struct({
  ...WorktreeScope,
  folder: RelativePath,
});
export type ListWorktreeFolder = typeof ListWorktreeFolder.Type;

export const WorktreeEntry = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)),
  kind: Schema.Literals(["file", "folder", "symlink", "submodule"]),
  ignored: Schema.Boolean,
});
export type WorktreeEntry = typeof WorktreeEntry.Type;

export const WorktreeFolder = Schema.Struct({
  entries: Schema.Array(WorktreeEntry).check(
    Schema.isMaxLength(maximumFolderEntries),
  ),
  complete: Schema.Boolean,
});
export type WorktreeFolder = typeof WorktreeFolder.Type;

export const ReadWorktreeFile = Schema.Struct({
  ...WorktreeScope,
  path: RepositoryPath,
});
export type ReadWorktreeFile = typeof ReadWorktreeFile.Type;

export const WorktreeFile = Schema.Union([
  Schema.TaggedStruct("Text", {
    contents: Schema.String,
    bytes: Schema.Int,
    truncated: Schema.Boolean,
  }),
  Schema.TaggedStruct("Binary", { bytes: Schema.Int }),
  Schema.TaggedStruct("Symlink", {
    target: Schema.String.check(Schema.isMaxLength(4_096)),
  }),
  Schema.TaggedStruct("Submodule", { oid: Schema.NullOr(ObjectId) }),
  Schema.TaggedStruct("Missing", {}),
]);
export type WorktreeFile = typeof WorktreeFile.Type;

export const SearchWorktree = Schema.Struct({
  ...WorktreeScope,
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
});
export type SearchWorktree = typeof SearchWorktree.Type;

export const WorktreeNameMatches = Schema.Struct({
  paths: Schema.Array(RepositoryPath).check(
    Schema.isMaxLength(maximumSearchResults),
  ),
  complete: Schema.Boolean,
});
export type WorktreeNameMatches = typeof WorktreeNameMatches.Type;

export const WorktreeTextMatch = Schema.Struct({
  path: RepositoryPath,
  line: Schema.Int,
  text: Schema.String.check(Schema.isMaxLength(512)),
});
export type WorktreeTextMatch = typeof WorktreeTextMatch.Type;

export const WorktreeTextMatches = Schema.Struct({
  matches: Schema.Array(WorktreeTextMatch).check(
    Schema.isMaxLength(maximumSearchResults),
  ),
  complete: Schema.Boolean,
});
export type WorktreeTextMatches = typeof WorktreeTextMatches.Type;

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
