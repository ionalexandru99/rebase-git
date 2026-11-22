import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryPath,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";

const Revision = z.string().max(128);

export const ConflictSide = z.enum(["base", "current", "incoming"]);
export type ConflictSide = z.infer<typeof ConflictSide>;

export const ConflictKind = z.enum([
  "both-modified",
  "both-added",
  "both-deleted",
  "deleted-in-current",
  "deleted-in-incoming",
  "added-in-current",
  "added-in-incoming",
]);
export type ConflictKind = z.infer<typeof ConflictKind>;

export const WholeFileChoice = z.enum(["current", "incoming", "delete"]);
export type WholeFileChoice = z.infer<typeof WholeFileChoice>;

export const SideLabel = z.object({
  ref: z.string().nullable(),
  commit: ObjectId.nullable(),
  subject: z.string().nullable(),
});
export type SideLabel = z.infer<typeof SideLabel>;

export const ConflictSides = z.object({
  base: SideLabel,
  current: SideLabel,
  incoming: SideLabel,
});
export type ConflictSides = z.infer<typeof ConflictSides>;

export const ConflictStage = z.object({
  side: ConflictSide,
  bytes: z.int().nonnegative(),
  binary: z.boolean(),
});
export type ConflictStage = z.infer<typeof ConflictStage>;

export const ConflictFile = z.object({
  path: RepositoryPath,
  revision: Revision,
  kind: ConflictKind,
  stages: z.array(ConflictStage).readonly(),
  openRegions: z.int().nonnegative(),
  choices: z.array(WholeFileChoice).readonly(),
});
export type ConflictFile = z.infer<typeof ConflictFile>;

export const ConflictList = z.object({
  sides: ConflictSides,
  files: z.array(ConflictFile).readonly(),
});
export type ConflictList = z.infer<typeof ConflictList>;

const LineNumber = z.int().gt(0);

export const ConflictExcerpt = z.object({
  line: LineNumber,
  text: z.string(),
});
export type ConflictExcerpt = z.infer<typeof ConflictExcerpt>;

export const ConflictDocument = z.object({
  file: ConflictFile,
  excerpts: z.array(ConflictExcerpt).readonly(),
});
export type ConflictDocument = z.infer<typeof ConflictDocument>;

export const ConflictPath = z.object({
  ...WorktreeScope.shape,
  path: RepositoryPath,
});
export type ConflictPath = z.infer<typeof ConflictPath>;

export const EditConflict = z.object({
  ...ConflictPath.shape,
  revision: Revision,
  line: LineNumber,
  count: z.int().nonnegative(),
  text: z.string(),
});
export type EditConflict = z.infer<typeof EditConflict>;

export const ChooseConflict = z.object({
  ...ConflictPath.shape,
  revision: Revision,
  choice: WholeFileChoice,
});
export type ChooseConflict = z.infer<typeof ChooseConflict>;

export const StageConflict = z.object({
  ...ConflictPath.shape,
  revision: Revision,
  allowMarkers: z.boolean(),
});
export type StageConflict = z.infer<typeof StageConflict>;

export const ConflictFailure = z.object({
  _tag: z.literal("ConflictFailed"),
  reason: z.enum(["Missing", "Stale", "Unsupported", "Markers", "TooLarge"]),
  detail: z.string().max(2048),
});
export type ConflictFailure = z.infer<typeof ConflictFailure>;

export const RepositoryConflictsApi = {
  list: repositoryQuery("repositories/conflicts/list", {
    request: WorktreeScope,
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
