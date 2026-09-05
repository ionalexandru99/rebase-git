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

const HistoryString = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      new TextEncoder().encode(value).byteLength <= 1_048_576 ||
      "String is too large",
  ),
);

export const RepositoryCommitIdentity = Schema.Struct({
  email: HistoryString,
  name: HistoryString,
  timestampSeconds: Schema.Int,
  timezoneOffsetMinutes: Schema.Int.check(
    Schema.isBetween({ minimum: -32_768, maximum: 32_767 }),
  ),
});
export type RepositoryCommitIdentity = typeof RepositoryCommitIdentity.Type;

export const RepositoryCommit = Schema.Struct({
  author: RepositoryCommitIdentity,
  committer: RepositoryCommitIdentity,
  oid: ObjectId,
  parents: Schema.Array(ObjectId).check(Schema.isMaxLength(4_096)),
  subject: HistoryString,
});
export type RepositoryCommit = typeof RepositoryCommit.Type;

const ObjectFormat = Schema.Literals(["sha1", "sha256"]);

export const RepositoryHistorySnapshot = Schema.Struct({
  shallowOids: Schema.optionalKey(SnapshotRootOids),
  id: SnapshotId,
  objectFormat: ObjectFormat,
  refTargets: Schema.Array(RepositoryHistoryRefTarget).check(
    Schema.isMaxLength(40_512),
  ),
  resumable: Schema.Boolean,
  rootOids: SnapshotRootOids,
});
export type RepositoryHistorySnapshot = typeof RepositoryHistorySnapshot.Type;

export const RepositoryHistoryPage = Schema.Struct({
  commits: Schema.Array(RepositoryCommit).check(Schema.isMaxLength(1_000)),
  objectFormat: ObjectFormat,
  refTargets: Schema.Array(RepositoryHistoryRefTarget).check(
    Schema.isMaxLength(256),
  ),
  repositoryId: RepositoryId,
  requestId: EnvironmentRequestId,
}).check(Schema.makeFilter(hasMatchingObjectIds));
export type RepositoryHistoryPage = typeof RepositoryHistoryPage.Type;

export const RepositoryHistoryBatch = Schema.Struct({
  commits: Schema.Array(RepositoryCommit).check(Schema.isMaxLength(512)),
  objectFormat: ObjectFormat,
  repositoryId: RepositoryId,
  requestId: EnvironmentRequestId,
  sequence: RepositoryHistorySequence,
  snapshot: Schema.optionalKey(RepositoryHistorySnapshot),
}).check(
  Schema.makeFilter((batch) => {
    if (!hasMatchingObjectIds(batch)) return false;
    const snapshot = batch.snapshot;
    if (snapshot === undefined) return true;
    const oidLength = batch.objectFormat === "sha1" ? 40 : 64;
    return (
      snapshot.objectFormat === batch.objectFormat &&
      snapshot.refTargets.every((ref) => ref.oid.length === oidLength) &&
      snapshot.rootOids.every((oid) => oid.length === oidLength) &&
      (snapshot.shallowOids ?? []).every((oid) => oid.length === oidLength)
    );
  }),
);
export type RepositoryHistoryBatch = typeof RepositoryHistoryBatch.Type;

function hasMatchingObjectIds(history: {
  readonly objectFormat: "sha1" | "sha256";
  readonly commits: readonly RepositoryCommit[];
  readonly refTargets?: readonly RepositoryHistoryRefTarget[];
}) {
  const oidLength = history.objectFormat === "sha1" ? 40 : 64;
  return (
    history.commits.every(
      (commit) =>
        commit.oid.length === oidLength &&
        commit.parents.every((oid) => oid.length === oidLength),
    ) && (history.refTargets ?? []).every((ref) => ref.oid.length === oidLength)
  );
}
