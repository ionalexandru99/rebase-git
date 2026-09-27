import {
  repositoryCommand,
  repositoryQuery,
} from "@rebase/contracts/environment-connection/environment-route.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

const Revision = Schema.String.check(Schema.isMaxLength(128));
const ObjectId = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40,64}$/));

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
]);
export type WholeFileChoice = typeof WholeFileChoice.Type;

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
  sides: ConflictSides,
  files: Schema.Array(ConflictFile),
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
  current: Schema.Array(Schema.String),
  base: Schema.Array(Schema.String),
  incoming: Schema.Array(Schema.String),
  marks: Schema.Struct({
    current: Schema.Array(TokenMark),
    incoming: Schema.Array(TokenMark),
  }),
  open: Schema.Boolean,
});
export type ConflictRegion = typeof ConflictRegion.Type;

export const ConflictDocument = Schema.Struct({
  file: ConflictFile,
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
  ]),
  detail: Schema.String.check(Schema.isMaxLength(2048)),
});
export type ConflictFailure = typeof ConflictFailure.Type;

export const RepositoryConflictsApi = {
  list: repositoryQuery("repositories/conflicts/list", {
    request: ConflictScope,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  document: repositoryQuery("repositories/conflicts/document", {
    request: ConflictPath,
    success: ConflictDocument,
    failure: ConflictFailure,
  }),
  write: repositoryCommand("repositories/conflicts/write", {
    request: WriteConflict,
    success: ConflictDocument,
    failure: ConflictFailure,
  }),
  choose: repositoryCommand("repositories/conflicts/choose", {
    request: ChooseConflict,
    success: ConflictList,
    failure: ConflictFailure,
  }),
  stage: repositoryCommand("repositories/conflicts/stage", {
    request: StageConflict,
    success: ConflictList,
    failure: ConflictFailure,
  }),
};
