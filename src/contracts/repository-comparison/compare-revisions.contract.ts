import { Schema } from "effect";
import {
  CommitFile,
  InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";
import { ChangesFailure } from "#contracts/repository-changes/repository-changes.contract.ts";
import { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import { RepositoryRefTarget } from "#contracts/repository-refs/repository-refs.contract.ts";

export const maximumComparisonCommits = 1_000;

export const ComparisonSide = Schema.Union([
  RepositoryRefTarget,
  Schema.TaggedStruct("Commit", { oid: ObjectId }),
]);
export type ComparisonSide = typeof ComparisonSide.Type;
export const isComparisonSide = Schema.is(ComparisonSide);

export const CompareRevisions = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  from: ComparisonSide,
  to: ComparisonSide,
});
export type CompareRevisions = typeof CompareRevisions.Type;

export const ComparisonCommit = Schema.Struct({
  oid: ObjectId,
  parentOid: Schema.NullOr(ObjectId),
  subject: Schema.String.check(Schema.isMaxLength(1_024)),
});
export type ComparisonCommit = typeof ComparisonCommit.Type;

export const Comparison = Schema.Struct({
  from: ObjectId,
  to: ObjectId,
  base: Schema.NullOr(ObjectId),
  files: Schema.Array(CommitFile),
  truncated: Schema.Boolean,
  commits: Schema.Array(ComparisonCommit).check(
    Schema.isMaxLength(maximumComparisonCommits),
  ),
  commitsComplete: Schema.Boolean,
});
export type Comparison = typeof Comparison.Type;

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
