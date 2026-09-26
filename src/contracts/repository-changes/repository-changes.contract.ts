import {
  type EnvironmentHttpRoute,
  repositoryCommand,
  repositoryQuery,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { ChangeDiff } from "@rebase/contracts/repository-comparison/repository-comparison.contract";
import { Schema } from "effect";

const Revision = Schema.String.check(Schema.isMaxLength(128));
export const ChangeSection = Schema.Literals(["unstaged", "staged"]);
export type ChangeSection = typeof ChangeSection.Type;
export const ChangesScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  amend: Schema.Boolean,
});
export type ChangesScope = typeof ChangesScope.Type;
export const ChangedFile = Schema.Struct({
  path: RepositoryPath,
  previousPath: Schema.NullOr(RepositoryPath),
  status: Schema.Literals(["A", "M", "D", "R", "T", "U", "?"]),
});
export type ChangedFile = typeof ChangedFile.Type;
export const RepositoryChanges = Schema.Struct({
  revision: Revision,
  head: Schema.NullOr(Schema.String),
  message: Schema.String,
  unstaged: Schema.Array(ChangedFile),
  staged: Schema.Array(ChangedFile),
  truncated: Schema.Boolean,
  renamesLimited: Schema.Boolean,
});
export type RepositoryChanges = typeof RepositoryChanges.Type;
export const ViewedChange = Schema.Struct({
  section: ChangeSection,
  path: RepositoryPath,
});
export type ViewedChange = typeof ViewedChange.Type;
export const ReadChangeDiff = Schema.Struct({
  ...ChangesScope.fields,
  ...ViewedChange.fields,
});
export type ReadChangeDiff = typeof ReadChangeDiff.Type;
export const ChangesWritten = Schema.Struct({
  changes: RepositoryChanges,
  diff: Schema.NullOr(ChangeDiff),
});
export type ChangesWritten = typeof ChangesWritten.Type;
export const ChangeSelection = Schema.Union([
  Schema.TaggedStruct("All", {}),
  Schema.TaggedStruct("Files", {
    paths: Schema.Array(RepositoryPath).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(1000),
    ),
  }),
  Schema.TaggedStruct("Lines", {
    path: RepositoryPath,
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
  viewed: Schema.optionalKey(ViewedChange),
});
export type MutateChanges = typeof MutateChanges.Type;
export const CommitChanges = Schema.Struct({
  ...ChangesScope.fields,
  revision: Revision,
  message: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(32000),
  ),
  viewed: Schema.optionalKey(ViewedChange),
});
export type CommitChanges = typeof CommitChanges.Type;
export const ChangesFailure = Schema.TaggedStruct("ChangesFailed", {
  reason: Schema.Literals(["Stale", "Conflict", "Unsupported"]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
});
export type ChangesFailure = typeof ChangesFailure.Type;

export function changesFailed(
  reason: ChangesFailure["reason"],
  detail: string,
): ChangesFailure {
  return { _tag: "ChangesFailed", reason, detail: detail.slice(0, 2048) };
}

export const RepositoryChangesHttpApi = {
  read: repositoryQuery("/api/repositories/changes/read", {
    request: ChangesScope,
    success: RepositoryChanges,
    failure: ChangesFailure,
  }),
  diff: repositoryQuery("/api/repositories/changes/diff", {
    request: ReadChangeDiff,
    success: ChangeDiff,
    failure: ChangesFailure,
  }),
  mutate: repositoryCommand("/api/repositories/changes/mutate", {
    request: MutateChanges,
    success: ChangesWritten,
    failure: ChangesFailure,
  }),
  commit: repositoryCommand("/api/repositories/changes/commit", {
    request: CommitChanges,
    success: ChangesWritten,
    failure: ChangesFailure,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
