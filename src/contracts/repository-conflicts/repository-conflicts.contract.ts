import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

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

const LineNumber = Schema.Int.check(Schema.isGreaterThan(0));

export const ConflictExcerpt = Schema.Struct({
  line: LineNumber,
  text: Schema.String,
});
export type ConflictExcerpt = typeof ConflictExcerpt.Type;

export const ConflictDocument = Schema.Struct({
  file: ConflictFile,
  excerpts: Schema.Array(ConflictExcerpt),
});
export type ConflictDocument = typeof ConflictDocument.Type;

export const ConflictPath = Schema.Struct({
  ...ConflictScope.fields,
  path: RepositoryPath,
});
export type ConflictPath = typeof ConflictPath.Type;

export const EditConflict = Schema.Struct({
  ...ConflictPath.fields,
  revision: Revision,
  line: LineNumber,
  count: Schema.Natural,
  text: Schema.String,
});
export type EditConflict = typeof EditConflict.Type;

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
  edit: repositoryCommand("repositories/conflicts/edit", {
    request: EditConflict,
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
