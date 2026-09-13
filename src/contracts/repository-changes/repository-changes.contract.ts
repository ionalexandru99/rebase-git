import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { Schema } from "effect";

const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
);
const Revision = Schema.String.check(Schema.isMaxLength(128));
export const ChangeSection = Schema.Literals(["unstaged", "staged"]);
export type ChangeSection = typeof ChangeSection.Type;
export const ChangesScope = Schema.Struct({
  repositoryId: Schema.String.check(Schema.isUUID(4)),
  worktreePath: Path,
  amend: Schema.Boolean,
});
export type ChangesScope = typeof ChangesScope.Type;
export const ChangedFile = Schema.Struct({
  path: Path,
  status: Schema.Literals(["A", "M", "D", "T", "U", "?"]),
});
export type ChangedFile = typeof ChangedFile.Type;
export const RepositoryChanges = Schema.Struct({
  revision: Revision,
  head: Schema.NullOr(Schema.String),
  message: Schema.String,
  unstaged: Schema.Array(ChangedFile),
  staged: Schema.Array(ChangedFile),
  truncated: Schema.Boolean,
});
export type RepositoryChanges = typeof RepositoryChanges.Type;
export const ReadChangeDiff = Schema.Struct({
  ...ChangesScope.fields,
  section: ChangeSection,
  path: Path,
});
export type ReadChangeDiff = typeof ReadChangeDiff.Type;
export const ChangeDiff = Schema.Struct({
  path: Path,
  revision: Revision,
  kind: Schema.Literals([
    "text",
    "image",
    "binary",
    "large",
    "conflict",
    "submodule",
    "symlink",
  ]),
  before: Schema.NullOr(Schema.String),
  after: Schema.NullOr(Schema.String),
  beforeBytes: Schema.Natural,
  afterBytes: Schema.Natural,
  mime: Schema.NullOr(Schema.String),
  patch: Schema.String,
});
export type ChangeDiff = typeof ChangeDiff.Type;
export const ChangeSelection = Schema.Union([
  Schema.TaggedStruct("All", {}),
  Schema.TaggedStruct("Files", {
    paths: Schema.Array(Path).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1000),
    ),
  }),
  Schema.TaggedStruct("Lines", {
    path: Path,
    revision: Revision,
    lines: Schema.Array(
      Schema.String.check(Schema.isPattern(/^[+-][1-9][0-9]*$/)),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(10000)),
  }),
]);
export type ChangeSelection = typeof ChangeSelection.Type;
export const MutateChanges = Schema.Struct({
  ...ChangesScope.fields,
  revision: Revision,
  section: ChangeSection,
  action: Schema.Literals(["stage", "unstage", "discard"]),
  selection: ChangeSelection,
});
export type MutateChanges = typeof MutateChanges.Type;
export const CommitChanges = Schema.Struct({
  ...ChangesScope.fields,
  revision: Revision,
  message: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32000),
  ),
});
export type CommitChanges = typeof CommitChanges.Type;
export const ChangesFailure = Schema.TaggedStruct("ChangesFailed", {
  reason: Schema.Literals([
    "Missing",
    "Stale",
    "Conflict",
    "Unsupported",
    "Busy",
    "GitFailed",
  ]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
});
export type ChangesFailure = typeof ChangesFailure.Type;
export const ChangesHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  ChangesFailure,
]);
export const RepositoryChangesHttpApi = {
  read: {
    path: "/api/repositories/changes/read",
    request: ChangesScope,
    success: RepositoryChanges,
  },
  diff: {
    path: "/api/repositories/changes/diff",
    request: ReadChangeDiff,
    success: ChangeDiff,
  },
  mutate: {
    path: "/api/repositories/changes/mutate",
    request: MutateChanges,
    success: RepositoryChanges,
  },
  commit: {
    path: "/api/repositories/changes/commit",
    request: CommitChanges,
    success: RepositoryChanges,
  },
} as const;
