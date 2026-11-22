import { z } from "zod";
import {
  CommitFile,
  InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import { ObjectId, WorktreeScope } from "#contracts/git/git-values.contract.ts";
import { ChangesFailure } from "#contracts/repository-changes/repository-changes.contract.ts";
import { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import { RepositoryRefTarget } from "#contracts/repository-refs/repository-refs.contract.ts";

export const maximumComparisonCommits = 1_000;

export const ComparisonSide = z.discriminatedUnion("_tag", [
  RepositoryRefTarget,
  z.object({ _tag: z.literal("Commit"), oid: ObjectId }),
]);
export type ComparisonSide = z.infer<typeof ComparisonSide>;
export const isComparisonSide = (value: unknown): value is ComparisonSide =>
  ComparisonSide.safeParse(value).success;

export const CompareRevisions = z.object({
  ...WorktreeScope.shape,
  from: ComparisonSide,
  to: ComparisonSide,
});
export type CompareRevisions = z.infer<typeof CompareRevisions>;

export const ComparisonCommit = z.object({
  oid: ObjectId,
  parentOid: ObjectId.nullable(),
  subject: z.string().max(1_024),
});
export type ComparisonCommit = z.infer<typeof ComparisonCommit>;

export const Comparison = z.object({
  from: ObjectId,
  to: ObjectId,
  base: ObjectId.nullable(),
  files: z.array(CommitFile).readonly(),
  truncated: z.boolean(),
  commits: z.array(ComparisonCommit).max(maximumComparisonCommits).readonly(),
  commitsComplete: z.boolean(),
});
export type Comparison = z.infer<typeof Comparison>;

export const CompareApi = {
  compare: repositoryQuery("repositories/compare", {
    request: CompareRevisions,
    success: Comparison,
    failure: ChangesFailure,
  }),
  diff: repositoryQuery("repositories/compare/diff", {
    request: InspectCommitDiff,
    success: ChangeDiff,
    failure: ChangesFailure,
  }),
};
