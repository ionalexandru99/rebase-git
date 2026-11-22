import { z } from "zod";
import { streamRoute } from "#contracts/environment-connection/environment-route.contract.ts";
import { ObjectId, RepositoryId } from "#contracts/git/git-values.contract.ts";

const HistoryTips = z.array(ObjectId).max(40_512).readonly();
const ObjectFormat = z.enum(["sha1", "sha256"]);

const HistoryString = z
  .string()
  .refine((value) => new TextEncoder().encode(value).byteLength <= 1_048_576, {
    message: "String is too large",
  });

export const RepositoryHistoryRefTarget = z.object({
  name: z.string().min(1).max(1_024),
  oid: ObjectId,
  type: z.enum(["branch", "commit", "head", "remote-branch", "tag"]),
});
export type RepositoryHistoryRefTarget = z.infer<
  typeof RepositoryHistoryRefTarget
>;

export const RepositoryCommitIdentity = z.object({
  email: HistoryString,
  name: HistoryString,
  timestampSeconds: z.int(),
  timezoneOffsetMinutes: z.int().min(-32_768).max(32_767),
});
export type RepositoryCommitIdentity = z.infer<typeof RepositoryCommitIdentity>;

export const RepositoryCommit = z.object({
  author: RepositoryCommitIdentity,
  committer: RepositoryCommitIdentity,
  oid: ObjectId,
  parents: z.array(ObjectId).max(4_096).readonly(),
  subject: HistoryString,
});
export type RepositoryCommit = z.infer<typeof RepositoryCommit>;

export const SynchronizeRepositoryHistory = z.object({
  repositoryId: RepositoryId,
  knownTips: HistoryTips,
  shallowOids: HistoryTips,
});
export type SynchronizeRepositoryHistory = z.infer<
  typeof SynchronizeRepositoryHistory
>;

export const RepositoryHistoryTips = z.object({
  _tag: z.literal("RepositoryHistoryTips"),
  objectFormat: ObjectFormat,
  rootOids: HistoryTips,
  shallowOids: HistoryTips,
  refTargets: z.array(RepositoryHistoryRefTarget).max(40_512).readonly(),
});
export type RepositoryHistoryTips = z.infer<typeof RepositoryHistoryTips>;

export const RepositoryHistoryCommits = z.object({
  _tag: z.literal("RepositoryHistoryCommits"),
  commits: z.array(RepositoryCommit).max(512).readonly(),
});
export type RepositoryHistoryCommits = z.infer<typeof RepositoryHistoryCommits>;

export const RepositoryHistoryUpdate = z.discriminatedUnion("_tag", [
  RepositoryHistoryTips,
  RepositoryHistoryCommits,
]);
export type RepositoryHistoryUpdate = z.infer<typeof RepositoryHistoryUpdate>;

export const RepositoryHistoryFailure = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("RepositoryMissing"),
    repositoryId: RepositoryId,
  }),
  z.object({
    _tag: z.literal("GitFailed"),
    detail: z.string().max(2_048).optional(),
    reason: z.enum([
      "GitUnavailable",
      "NotRepository",
      "Timeout",
      "OutputTooLarge",
      "Failed",
    ]),
  }),
]);
export type RepositoryHistoryFailure = z.infer<typeof RepositoryHistoryFailure>;

export const RepositoryHistoryApi = {
  synchronize: streamRoute("SynchronizeHistory", {
    request: SynchronizeRepositoryHistory,
    success: RepositoryHistoryUpdate,
    failure: RepositoryHistoryFailure,
  }),
};
