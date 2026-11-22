import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";

const Revision = z.string().max(128);
export const ChangeSection = z.enum(["unstaged", "staged"]);
export type ChangeSection = z.infer<typeof ChangeSection>;
export const ChangesScope = z.object({
  ...WorktreeScope.shape,
  amend: z.boolean(),
});
export type ChangesScope = z.infer<typeof ChangesScope>;
export const ChangedLines = z
  .object({ added: z.number(), removed: z.number() })
  .nullable();
export type ChangedLines = z.infer<typeof ChangedLines>;
export const ChangedFile = z.object({
  path: RepositoryPath,
  previousPath: RepositoryPath.nullable(),
  status: z.enum(["A", "M", "D", "R", "T", "U", "?"]),
  lines: ChangedLines,
  lfs: z.boolean(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;
export const RepositoryChanges = z.object({
  revision: Revision,
  head: z.string().nullable(),
  message: z.string(),
  unstaged: z.array(ChangedFile).readonly(),
  staged: z.array(ChangedFile).readonly(),
  renamesLimited: z.boolean(),
});
export type RepositoryChanges = z.infer<typeof RepositoryChanges>;
export const ViewedChange = z.object({
  section: ChangeSection,
  path: RepositoryPath,
});
export type ViewedChange = z.infer<typeof ViewedChange>;
export const ReadChangeDiff = z.object({
  ...ChangesScope.shape,
  ...ViewedChange.shape,
  whole: z.boolean().optional(),
});
export type ReadChangeDiff = z.infer<typeof ReadChangeDiff>;
export const ChangesWritten = z.object({
  changes: RepositoryChanges,
  diff: ChangeDiff.nullable(),
});
export type ChangesWritten = z.infer<typeof ChangesWritten>;
export const ChangeSelection = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("All") }),
  z.object({
    _tag: z.literal("Files"),
    paths: z.array(RepositoryPath).min(1).max(1000).readonly(),
  }),
  z.object({
    _tag: z.literal("Lines"),
    path: RepositoryPath,
    revision: Revision,
    lines: z
      .array(z.string().regex(/^[+-][1-9][0-9]*$/))
      .min(1)
      .max(10000)
      .readonly(),
  }),
]);
export type ChangeSelection = z.infer<typeof ChangeSelection>;
export const MutateChanges = z.object({
  ...ChangesScope.shape,
  revision: Revision,
  section: ChangeSection,
  action: z.enum(["stage", "unstage", "discard"]),
  selection: ChangeSelection,
  viewed: ViewedChange.exactOptional(),
});
export type MutateChanges = z.infer<typeof MutateChanges>;
const Tree = z.string().regex(/^[0-9a-f]{40,64}$/);
const ChangesSnapshot = z.object({ index: Tree, worktree: Tree });
export const DiscardedChanges = z.object({
  before: ChangesSnapshot,
  after: ChangesSnapshot,
});
export type DiscardedChanges = z.infer<typeof DiscardedChanges>;
export const ChangesMutated = z.object({
  ...ChangesWritten.shape,
  discarded: DiscardedChanges.nullable(),
});
export type ChangesMutated = z.infer<typeof ChangesMutated>;
export const UndoDiscard = z.object({
  ...ChangesScope.shape,
  discarded: DiscardedChanges,
  viewed: ViewedChange.exactOptional(),
});
export type UndoDiscard = z.infer<typeof UndoDiscard>;
export const CommitChanges = z.object({
  ...ChangesScope.shape,
  revision: Revision,
  message: z.string().min(1).max(32000),
  viewed: ViewedChange.exactOptional(),
});
export type CommitChanges = z.infer<typeof CommitChanges>;
export const maximumIgnoredPaths = 1000;
export const IgnoreTarget = z.enum(["repository", "local"]);
export type IgnoreTarget = z.infer<typeof IgnoreTarget>;
export const IgnorePaths = z.object({
  ...ChangesScope.shape,
  target: IgnoreTarget.nullable(),
  paths: z.array(RepositoryPath).min(1).max(maximumIgnoredPaths).readonly(),
  untrack: z.boolean(),
  viewed: ViewedChange.exactOptional(),
});
export type IgnorePaths = z.infer<typeof IgnorePaths>;
export const IgnoreTracked = z.object({
  _tag: z.literal("IgnoreTracked"),
  path: RepositoryPath,
  count: z.number(),
});
export type IgnoreTracked = z.infer<typeof IgnoreTracked>;

export function ignoreTracked(path: string, count: number): IgnoreTracked {
  return { _tag: "IgnoreTracked", path, count };
}
export const ReadIgnoreRule = z.object({
  ...WorktreeScope.shape,
  path: RepositoryPath,
  includeTracked: z.boolean(),
});
export type ReadIgnoreRule = z.infer<typeof ReadIgnoreRule>;
export const IgnoreRule = z.object({
  pattern: z.string().max(4096),
  file: z.string().max(4096),
  line: z.int(),
  inWorktree: z.boolean(),
});
export type IgnoreRule = z.infer<typeof IgnoreRule>;
export const ChangesFailure = z.object({
  _tag: z.literal("ChangesFailed"),
  reason: z.enum(["Stale", "Conflict", "Unsupported"]),
  detail: z.string().max(2048),
});
export type ChangesFailure = z.infer<typeof ChangesFailure>;

export function changesFailed(
  reason: ChangesFailure["reason"],
  detail: string,
): ChangesFailure {
  return { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) };
}

export const RepositoryChangesApi = {
  read: repositoryQuery("repositories/changes/read", {
    request: ChangesScope,
    success: RepositoryChanges,
    failure: ChangesFailure,
  }),
  diff: repositoryQuery("repositories/changes/diff", {
    request: ReadChangeDiff,
    success: ChangeDiff,
    failure: ChangesFailure,
  }),
  mutate: repositoryCommand("repositories/changes/mutate", {
    request: MutateChanges,
    success: ChangesMutated,
    failure: ChangesFailure,
  }),
  undoDiscard: repositoryCommand("repositories/changes/undo-discard", {
    request: UndoDiscard,
    success: ChangesWritten,
    failure: ChangesFailure,
  }),
  ignore: repositoryCommand("repositories/changes/ignore", {
    request: IgnorePaths,
    success: ChangesWritten,
    failure: z.discriminatedUnion("_tag", [ChangesFailure, IgnoreTracked]),
  }),
  ignoreRule: repositoryQuery("repositories/changes/ignore-rule", {
    request: ReadIgnoreRule,
    success: IgnoreRule.nullable(),
  }),
  commit: repositoryCommand("repositories/changes/commit", {
    request: CommitChanges,
    success: ChangesWritten,
    failure: ChangesFailure,
  }),
};
