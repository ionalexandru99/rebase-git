import { Schema } from "effect";
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
const StashText = Schema.String.check(Schema.isMaxLength(1_024));

const StashScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});

export const RepositoryStash = Schema.Struct({
  oid: ObjectId,
  name: StashText,
  named: Schema.Boolean,
  auto: Schema.Boolean,
  branch: Schema.NullOr(StashText),
  staged: Schema.Boolean,
  recordedAt: Schema.Int,
});
export type RepositoryStash = typeof RepositoryStash.Type;

export const RepositoryStashes = Schema.Struct({
  stashes: Schema.Array(RepositoryStash).check(
    Schema.isMaxLength(maximumStashes),
  ),
  truncated: Schema.Boolean,
});
export type RepositoryStashes = typeof RepositoryStashes.Type;

export const StashTarget = Schema.Struct({
  ...StashScope.fields,
  oid: ObjectId,
});
export type StashTarget = typeof StashTarget.Type;

export const StashFile = Schema.Struct({
  ...CommitFile.fields,
  untracked: Schema.Boolean,
});
export type StashFile = typeof StashFile.Type;

export const StashContents = Schema.Struct({
  base: ObjectId,
  untracked: Schema.NullOr(ObjectId),
  files: Schema.Array(StashFile),
  truncated: Schema.Boolean,
});
export type StashContents = typeof StashContents.Type;

export const ApplyStash = Schema.Struct({
  ...StashTarget.fields,
  restoreIndex: Schema.Boolean,
  drop: Schema.Boolean,
});
export type ApplyStash = typeof ApplyStash.Type;

export const StashApplied = Schema.Struct({ conflicts: Schema.Natural });
export type StashApplied = typeof StashApplied.Type;

export const SaveStash = Schema.Struct({
  ...StashScope.fields,
  revision: Schema.String.check(Schema.isMaxLength(128)),
  into: Schema.NullOr(ObjectId),
  name: Schema.optional(StashText.check(Schema.isMinLength(1))),
  section: ChangeSection,
  paths: Schema.Array(RepositoryPath).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(1_000),
  ),
});
export type SaveStash = typeof SaveStash.Type;

export const StashMissing = Schema.TaggedStruct("StashMissing", {});
export type StashMissing = typeof StashMissing.Type;

export const StashRejected = Schema.TaggedStruct("StashRejected", {
  reason: Schema.Literals([
    "LocalChanges",
    "IndexConflict",
    "DoesNotFit",
    "Unborn",
  ]),
});
export type StashRejected = typeof StashRejected.Type;

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
    failure: Schema.Union([StashMissing, StashRejected]),
  }),
  drop: repositoryCommand("repositories/stashes/drop", {
    request: StashTarget,
    success: Schema.Struct({}),
    failure: StashMissing,
  }),
  save: repositoryCommand("repositories/stashes/save", {
    request: SaveStash,
    success: Schema.Struct({ oid: ObjectId }),
    failure: Schema.Union([StashMissing, StashRejected, ChangesFailure]),
  }),
};
