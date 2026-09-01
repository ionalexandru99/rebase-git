import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { Schema } from "effect";

const RepositoryId = Schema.String.check(Schema.isUUID(4));
const ObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
);

export const RepositoryHistoryRefTarget = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1_024)),
  oid: ObjectId,
  type: Schema.Literals(["branch", "head", "remote-branch", "tag"]),
});
export type RepositoryHistoryRefTarget = typeof RepositoryHistoryRefTarget.Type;

export const ReadRepositoryHistory = Schema.TaggedStruct(
  "ReadRepositoryHistory",
  {
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
    order: Schema.Literals(["topological", "chronological"]),
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
    roots: Schema.Array(RepositoryHistoryRefTarget).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(256),
    ),
  },
);
export type ReadRepositoryHistory = typeof ReadRepositoryHistory.Type;

export const CancelRepositoryHistory = Schema.TaggedStruct(
  "CancelRepositoryHistory",
  { requestId: EnvironmentRequestId },
);

export const RepositoryHistoryClientMessage = Schema.Union([
  ReadRepositoryHistory,
  CancelRepositoryHistory,
]);
export type RepositoryHistoryClientMessage =
  typeof RepositoryHistoryClientMessage.Type;

export const RepositoryHistoryOperationFailure = Schema.Union([
  Schema.TaggedStruct("AuthorizationDenied", {}),
  Schema.TaggedStruct("RepositoryMissing", { repositoryId: RepositoryId }),
  Schema.TaggedStruct("GitFailed", {
    detail: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
    reason: Schema.Literals([
      "GitUnavailable",
      "NotRepository",
      "Timeout",
      "OutputTooLarge",
      "Failed",
    ]),
  }),
]);
export type RepositoryHistoryOperationFailure =
  typeof RepositoryHistoryOperationFailure.Type;

export const RepositoryHistoryFailed = Schema.TaggedStruct(
  "RepositoryHistoryFailed",
  {
    failure: RepositoryHistoryOperationFailure,
    requestId: EnvironmentRequestId,
  },
);
export type RepositoryHistoryFailed = typeof RepositoryHistoryFailed.Type;

export interface RepositoryCommitIdentity {
  readonly email: string;
  readonly name: string;
  readonly timestampSeconds: number;
  readonly timezoneOffsetMinutes: number;
}

export interface RepositoryCommit {
  readonly author: RepositoryCommitIdentity;
  readonly committer: RepositoryCommitIdentity;
  readonly oid: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

export interface RepositoryHistoryPage {
  readonly commits: readonly RepositoryCommit[];
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly repositoryId: string;
  readonly requestId: string;
}
