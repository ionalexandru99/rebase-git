import {
  type EnvironmentHttpRoute,
  repositoryCommand,
  repositoryQuery,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { OperationKind } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Schema } from "effect";

const Revision = Schema.String.check(Schema.isMaxLength(128));
const ObjectId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/));
const Line = Schema.String.check(Schema.isMaxLength(100_000));

export const ConflictScope = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});
export type ConflictScope = typeof ConflictScope.Type;

export const ConflictSide = Schema.Literals(["base", "current", "incoming"]);
export type ConflictSide = typeof ConflictSide.Type;

export const ConflictKind = Schema.Literals([
  "both-modified",
  "both-added",
  "both-deleted",
  "deleted-in-current",
  "deleted-in-incoming",
  "added-in-current",
  "added-in-incoming",
]);
export type ConflictKind = typeof ConflictKind.Type;

export const WholeFileChoice = Schema.Literals([
  "current",
  "incoming",
  "delete",
  "worktree",
]);
export type WholeFileChoice = typeof WholeFileChoice.Type;

export const CommitSummary = Schema.Struct({
  commit: ObjectId,
  subject: Schema.String,
});
export type CommitSummary = typeof CommitSummary.Type;

export const SideLabel = Schema.Struct({
  ref: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(ObjectId),
  subject: Schema.NullOr(Schema.String),
});
export type SideLabel = typeof SideLabel.Type;

export const ConflictSides = Schema.Struct({
  base: SideLabel,
  current: SideLabel,
  incoming: SideLabel,
});
export type ConflictSides = typeof ConflictSides.Type;

export const ConflictStage = Schema.Struct({
  side: ConflictSide,
  oid: ObjectId,
  bytes: Schema.Natural,
  binary: Schema.Boolean,
});
export type ConflictStage = typeof ConflictStage.Type;

export const ConflictFile = Schema.Struct({
  path: RepositoryPath,
  revision: Revision,
  kind: ConflictKind,
  stages: Schema.Array(ConflictStage),
  openRegions: Schema.Natural,
  choices: Schema.Array(WholeFileChoice),
});
export type ConflictFile = typeof ConflictFile.Type;

export const ConflictList = Schema.Struct({
  operation: OperationKind,
  sides: ConflictSides,
  files: Schema.Array(ConflictFile),
  resolved: Schema.Array(RepositoryPath),
  mergeTool: Schema.NullOr(Schema.String),
});
export type ConflictList = typeof ConflictList.Type;

export const TokenMark = Schema.Struct({
  line: Schema.Natural,
  start: Schema.Natural,
  end: Schema.Natural,
});
export type TokenMark = typeof TokenMark.Type;

export const ConflictRegion = Schema.Struct({
  id: Schema.String,
  line: Schema.NullOr(Schema.Natural),
  current: Schema.Array(Line),
  base: Schema.Array(Line),
  incoming: Schema.Array(Line),
  blame: Schema.Struct({
    current: Schema.NullOr(CommitSummary),
    incoming: Schema.NullOr(CommitSummary),
  }),
  marks: Schema.Struct({
    current: Schema.Array(TokenMark),
    incoming: Schema.Array(TokenMark),
  }),
  open: Schema.Boolean,
});
export type ConflictRegion = typeof ConflictRegion.Type;

export const ConflictDocument = Schema.Struct({
  file: ConflictFile,
  sides: ConflictSides,
  content: Schema.String,
  regions: Schema.Array(ConflictRegion),
});
export type ConflictDocument = typeof ConflictDocument.Type;

export const ConflictPath = Schema.Struct({
  ...ConflictScope.fields,
  path: RepositoryPath,
});
export type ConflictPath = typeof ConflictPath.Type;

export const WriteConflict = Schema.Struct({
  ...ConflictPath.fields,
  revision: Revision,
  content: Schema.String,
});
export type WriteConflict = typeof WriteConflict.Type;

export const ChooseConflict = Schema.Struct({
  ...ConflictPath.fields,
  revision: Revision,
  choice: WholeFileChoice,
});
export type ChooseConflict = typeof ChooseConflict.Type;

export const StageConflict = Schema.Struct({
  ...ConflictPath.fields,
  revision: Revision,
  allowMarkers: Schema.Boolean,
});
export type StageConflict = typeof StageConflict.Type;

export const ConflictFailure = Schema.TaggedStruct("ConflictFailed", {
  reason: Schema.Literals([
    "Missing",
    "Stale",
    "Unsupported",
    "Markers",
    "TooLarge",
    "NoMergeTool",
    "GitRejected",
    "Uncertain",
  ]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
});
export type ConflictFailure = typeof ConflictFailure.Type;

export const RepositoryConflictsHttpApi = {
  list: repositoryQuery("/api/repositories/conflicts/list", {
    request: ConflictScope,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  document: repositoryQuery("/api/repositories/conflicts/document", {
    request: ConflictPath,
    success: ConflictDocument,
    failure: ConflictFailure,
  }),
  write: repositoryCommand("/api/repositories/conflicts/write", {
    request: WriteConflict,
    success: ConflictDocument,
    failure: ConflictFailure,
  }),
  choose: repositoryCommand("/api/repositories/conflicts/choose", {
    request: ChooseConflict,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  stage: repositoryCommand("/api/repositories/conflicts/stage", {
    request: StageConflict,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  reopen: repositoryCommand("/api/repositories/conflicts/reopen", {
    request: ConflictPath,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  mergeTool: repositoryCommand("/api/repositories/conflicts/merge-tool", {
    request: ConflictPath,
    success: ConflictList,
    failure: ConflictFailure,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
