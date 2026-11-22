import { z } from "zod";
import { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
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
  ChangeSection,
  ChangesFailure,
} from "#contracts/repository-changes/repository-changes.contract.ts";

const maximumStashes = 1_000;
const StashText = z.string().max(1_024);

const StashScope = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});

export const RepositoryStash = z.object({
  oid: ObjectId,
  name: StashText,
  named: z.boolean(),
  auto: z.boolean(),
  branch: StashText.nullable(),
  staged: z.boolean(),
  recordedAt: z.int(),
});
export type RepositoryStash = z.infer<typeof RepositoryStash>;

export const RepositoryStashes = z.object({
  stashes: z.array(RepositoryStash).max(maximumStashes).readonly(),
  truncated: z.boolean(),
});
export type RepositoryStashes = z.infer<typeof RepositoryStashes>;

export const StashTarget = z.object({
  ...StashScope.shape,
  oid: ObjectId,
});
export type StashTarget = z.infer<typeof StashTarget>;

export const StashFile = z.object({
  ...CommitFile.shape,
  untracked: z.boolean(),
});
export type StashFile = z.infer<typeof StashFile>;

export const StashContents = z.object({
  base: ObjectId,
  untracked: ObjectId.nullable(),
  files: z.array(StashFile).readonly(),
  truncated: z.boolean(),
});
export type StashContents = z.infer<typeof StashContents>;

export const ApplyStash = z.object({
  ...StashTarget.shape,
  restoreIndex: z.boolean(),
  drop: z.boolean(),
});
export type ApplyStash = z.infer<typeof ApplyStash>;

export const StashApplied = z.object({ conflicts: z.int().nonnegative() });
export type StashApplied = z.infer<typeof StashApplied>;

export const SaveStash = z.object({
  ...StashScope.shape,
  revision: z.string().max(128),
  into: ObjectId.nullable(),
  name: StashText.min(1).optional(),
  section: ChangeSection,
  paths: z.array(RepositoryPath).min(1).max(1_000).readonly(),
});
export type SaveStash = z.infer<typeof SaveStash>;

export const StashMissing = z.object({ _tag: z.literal("StashMissing") });
export type StashMissing = z.infer<typeof StashMissing>;

export const StashRejected = z.object({
  _tag: z.literal("StashRejected"),
  reason: z.enum(["LocalChanges", "IndexConflict", "DoesNotFit", "Unborn"]),
});
export type StashRejected = z.infer<typeof StashRejected>;

export const RepositoryStashesApi = {
  list: repositoryQuery("repositories/stashes/list", {
    request: StashScope,
    success: RepositoryStashes,
  }),
  contents: repositoryQuery("repositories/stashes/contents", {
    request: StashTarget,
    success: StashContents,
    failure: StashMissing,
  }),
  apply: repositoryCommand("repositories/stashes/apply", {
    request: ApplyStash,
    success: StashApplied,
    failure: z.discriminatedUnion("_tag", [StashMissing, StashRejected]),
  }),
  drop: repositoryCommand("repositories/stashes/drop", {
    request: StashTarget,
    success: z.object({}),
    failure: StashMissing,
  }),
  save: repositoryCommand("repositories/stashes/save", {
    request: SaveStash,
    success: z.object({ oid: ObjectId }),
    failure: z.discriminatedUnion("_tag", [
      StashMissing,
      StashRejected,
      ChangesFailure,
    ]),
  }),
};
