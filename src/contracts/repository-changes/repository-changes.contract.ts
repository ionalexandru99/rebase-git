import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
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
  path: RepositoryPath,
});
export type ReadChangeDiff = typeof ReadChangeDiff.Type;
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
    capability: "repository.read",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/changes/read",
    request: ChangesScope,
    success: RepositoryChanges,
    successStatus: 200,
  },
  diff: {
    capability: "repository.read",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/changes/diff",
    request: ReadChangeDiff,
    success: ChangeDiff,
    successStatus: 200,
  },
  mutate: {
    capability: "repository.write",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/changes/mutate",
    request: MutateChanges,
    success: RepositoryChanges,
    successStatus: 200,
  },
  commit: {
    capability: "repository.write",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/changes/commit",
    request: CommitChanges,
    success: RepositoryChanges,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
