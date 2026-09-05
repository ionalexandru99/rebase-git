import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { maximumRepositoryHistorySequence } from "@rebase/contracts/repository-history/repository-history-limits.contract";
import { Schema } from "effect";

const RepositoryId = Schema.String.check(Schema.isUUID(4));
const ObjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
);
const SnapshotId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const SnapshotRootOids = Schema.Array(ObjectId).check(
  Schema.isMaxLength(40_512),
);
const RepositoryHistorySequence = Schema.Int.check(
  Schema.isBetween({
    minimum: 0,
    maximum: maximumRepositoryHistorySequence,
  }),
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
    ancestry: Schema.optionalKey(Schema.Literals(["all", "first-parent"])),
    offset: Schema.optionalKey(
      Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: 2_147_482_647 }),
      ),
    ),
    additionalParentEdges: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({ childOid: ObjectId, parentOid: ObjectId }),
      ).check(Schema.isMaxLength(1_000)),
    ),
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

export const SynchronizeRepositoryHistory = Schema.TaggedStruct(
  "SynchronizeRepositoryHistory",
  {
    basis: Schema.optionalKey(
      Schema.Union([
        Schema.TaggedStruct("Complete", {
          shallowOids: Schema.optionalKey(SnapshotRootOids),
          commitCount: Schema.Natural,
          objectFormat: Schema.Literals(["sha1", "sha256"]),
          rootOids: SnapshotRootOids,
          snapshotId: SnapshotId,
        }),
        Schema.TaggedStruct("Incomplete", {
          shallowOids: Schema.optionalKey(SnapshotRootOids),
          committedCommitCount: Schema.Natural,
          nextBatchSequence: RepositoryHistorySequence,
          objectFormat: Schema.Literals(["sha1", "sha256"]),
          rootOids: SnapshotRootOids,
          snapshotId: SnapshotId,
        }),
      ]),
    ),
    priority: Schema.Literals(["background", "visible"]),
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
  },
);
export type SynchronizeRepositoryHistory =
  typeof SynchronizeRepositoryHistory.Type;

export const AcknowledgeRepositoryHistoryBatch = Schema.TaggedStruct(
  "AcknowledgeRepositoryHistoryBatch",
  {
    requestId: EnvironmentRequestId,
    sequence: RepositoryHistorySequence,
  },
);

export const RepositoryHistoryClientMessage = Schema.Union([
  ReadRepositoryHistory,
  SynchronizeRepositoryHistory,
  AcknowledgeRepositoryHistoryBatch,
  CancelRepositoryHistory,
]);
export type RepositoryHistoryClientMessage =
  typeof RepositoryHistoryClientMessage.Type;

export const RepositoryHistoryOperationFailure = Schema.Union([
  Schema.TaggedStruct("AuthorizationDenied", {}),
  Schema.TaggedStruct("RepositoryMissing", { repositoryId: RepositoryId }),
  Schema.TaggedStruct("SnapshotInvalidated", {}),
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

export const RepositoryHistorySynchronized = Schema.TaggedStruct(
  "RepositoryHistorySynchronized",
  {
    commitCount: Schema.Natural,
    requestId: EnvironmentRequestId,
  },
);
export type RepositoryHistorySynchronized =
  typeof RepositoryHistorySynchronized.Type;

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

export interface RepositoryHistoryBatch {
  readonly commits: readonly RepositoryCommit[];
  readonly objectFormat: "sha1" | "sha256";
  readonly repositoryId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly snapshot?: RepositoryHistorySnapshot;
}

export interface RepositoryHistorySnapshot {
  readonly shallowOids?: readonly string[];
  readonly id: string;
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly resumable: boolean;
  readonly rootOids: readonly string[];
}
