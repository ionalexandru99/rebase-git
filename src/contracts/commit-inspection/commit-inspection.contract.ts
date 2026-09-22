import { ChangeDiff } from "@rebase/contracts/repository-comparison/repository-comparison.contract";
import { Schema } from "effect";

const Oid = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
);
const Path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
);
export const InspectCommit = Schema.Struct({
  repositoryId: Schema.String.check(Schema.isUUID(4)),
  worktreePath: Path,
  oid: Oid,
  parentOid: Schema.optional(Oid),
});
export type InspectCommit = typeof InspectCommit.Type;
export const InspectCommitDiff = Schema.Struct({
  ...InspectCommit.fields,
  path: Path,
});
export type InspectCommitDiff = typeof InspectCommitDiff.Type;
const CommitIdentity = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  date: Schema.String,
});
export const CommitFile = Schema.Struct({
  path: Path,
  previousPath: Schema.NullOr(Path),
  status: Schema.Literals(["A", "M", "D", "R", "T"]),
});
export type CommitFile = typeof CommitFile.Type;
export const CommitInspection = Schema.Struct({
  oid: Oid,
  message: Schema.String,
  author: CommitIdentity,
  committer: CommitIdentity,
  parents: Schema.Array(Oid),
  parentOid: Schema.NullOr(Oid),
  files: Schema.Array(CommitFile),
  truncated: Schema.Boolean,
});
export type CommitInspection = typeof CommitInspection.Type;
export const CommitInspectionHttpApi = {
  inspect: {
    path: "/api/repositories/commits/inspect",
    request: InspectCommit,
    success: CommitInspection,
  },
  inspectDiff: {
    path: "/api/repositories/commits/diff",
    request: InspectCommitDiff,
    success: ChangeDiff,
  },
} as const;
