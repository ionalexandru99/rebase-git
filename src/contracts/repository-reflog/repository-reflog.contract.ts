import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RefName,
  WorktreeScope,
} from "#contracts/git/git-values.contract.ts";
import { RefMissing } from "#contracts/repository-refs/repository-refs.contract.ts";

const ReflogText = z.string().max(1_024);
const maximumEntries = 2_000;

export const ReflogRef = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Head") }),
  z.object({ _tag: z.literal("LocalBranch"), name: RefName }),
]);
export type ReflogRef = z.infer<typeof ReflogRef>;
export const isReflogRef = (value: unknown): value is ReflogRef =>
  ReflogRef.safeParse(value).success;

export const ReadRepositoryReflog = z.object({
  ...WorktreeScope.shape,
  ref: ReflogRef,
});
export type ReadRepositoryReflog = z.infer<typeof ReadRepositoryReflog>;

export const ReflogAction = z.enum([
  "commit",
  "amend",
  "merge",
  "switch",
  "reset",
  "rebase",
  "pull",
  "cherry-pick",
  "created",
  "other",
]);
export type ReflogAction = z.infer<typeof ReflogAction>;

export const ReflogStep = z.object({
  oid: ObjectId,
  label: z.string().max(32),
  description: ReflogText,
});
export type ReflogStep = z.infer<typeof ReflogStep>;

export const ReflogEntry = z.object({
  oid: ObjectId,
  previousOid: ObjectId.nullable(),
  action: ReflogAction,
  description: ReflogText,
  subject: ReflogText,
  recordedAt: z.int(),
  orphaned: z.boolean(),
  steps: z.array(ReflogStep).max(maximumEntries).readonly(),
});
export type ReflogEntry = z.infer<typeof ReflogEntry>;

export const RepositoryReflog = z.object({
  entries: z.array(ReflogEntry).max(maximumEntries).readonly(),
  truncated: z.boolean(),
});
export type RepositoryReflog = z.infer<typeof RepositoryReflog>;

export const ResetMode = z.enum(["soft", "mixed", "hard"]);
export type ResetMode = z.infer<typeof ResetMode>;

export const ResetToCommit = z.object({
  ...WorktreeScope.shape,
  target: ObjectId,
  mode: ResetMode,
  expectedHead: ObjectId,
  discard: z.string().max(128).optional(),
});
export type ResetToCommit = z.infer<typeof ResetToCommit>;

export const HeadMoved = z.object({
  _tag: z.literal("HeadMoved"),
  head: ObjectId.nullable(),
});
export type HeadMoved = z.infer<typeof HeadMoved>;

export const ResetDiscardsChanges = z.object({
  _tag: z.literal("ResetDiscardsChanges"),
  paths: z.array(z.string()).max(20).readonly(),
  count: z.int().nonnegative(),
  fingerprint: z.string().max(128),
});
export type ResetDiscardsChanges = z.infer<typeof ResetDiscardsChanges>;

export const ResetFailure = z.discriminatedUnion("_tag", [
  HeadMoved,
  ResetDiscardsChanges,
  RefMissing,
]);
export type ResetFailure = z.infer<typeof ResetFailure>;

export const RepositoryReflogApi = {
  read: repositoryQuery("repositories/reflog/read", {
    request: ReadRepositoryReflog,
    success: RepositoryReflog,
  }),
  reset: repositoryCommand("repositories/reflog/reset", {
    request: ResetToCommit,
    success: z.object({ head: ObjectId }),
    failure: ResetFailure,
  }),
};
