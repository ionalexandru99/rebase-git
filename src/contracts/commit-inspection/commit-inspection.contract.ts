import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { ChangesHttpFailure } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { ChangeDiff } from "@rebase/contracts/repository-comparison/repository-comparison.contract";
import { Schema } from "effect";

export const InspectCommit = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  oid: ObjectId,
  parentOid: Schema.optional(ObjectId),
});
export type InspectCommit = typeof InspectCommit.Type;
export const InspectCommitDiff = Schema.Struct({
  ...InspectCommit.fields,
  path: RepositoryPath,
});
export type InspectCommitDiff = typeof InspectCommitDiff.Type;
const CommitIdentity = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  date: Schema.String,
});
export const CommitFile = Schema.Struct({
  path: RepositoryPath,
  previousPath: Schema.NullOr(RepositoryPath),
  status: Schema.Literals(["A", "M", "D", "R", "T"]),
});
export type CommitFile = typeof CommitFile.Type;
export const CommitInspection = Schema.Struct({
  oid: ObjectId,
  message: Schema.String,
  author: CommitIdentity,
  committer: CommitIdentity,
  parents: Schema.Array(ObjectId),
  parentOid: Schema.NullOr(ObjectId),
  files: Schema.Array(CommitFile),
  truncated: Schema.Boolean,
});
export type CommitInspection = typeof CommitInspection.Type;
export const CommitInspectionHttpApi = {
  inspect: {
    capability: "repository.read",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/commits/inspect",
    request: InspectCommit,
    success: CommitInspection,
    successStatus: 200,
  },
  inspectDiff: {
    capability: "repository.read",
    failure: ChangesHttpFailure,
    failureStatuses: [400, 401, 403, 404, 409, 410, 413],
    method: "POST",
    path: "/api/repositories/commits/diff",
    request: InspectCommitDiff,
    success: ChangeDiff,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
