import {
  maximumRepositoryHistorySequence,
  type RepositoryHistoryBatch,
  type RepositoryHistorySnapshot,
  type SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { GitObjectFormat } from "#server/domain/git-object-id";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  historyFailed,
  type RepositoryHistoryError,
  snapshotInvalidated,
} from "#server/features/repository-history/git/history-failures";
import { historyTraversalIdentity } from "#server/features/repository-history/git/history-snapshot-identity";
import type { ObjectFormatRead } from "#server/features/repository-history/git/read-object-format";
import { readRepositoryHistorySnapshot } from "#server/features/repository-history/git/read-repository-history-snapshot";
import { streamRepositoryHistory } from "#server/features/repository-history/git/stream-repository-history";

const maximumReconciliationPasses = 8;

type SynchronizationBasis = NonNullable<SynchronizeRepositoryHistory["basis"]>;

export function synchronizeRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: SynchronizeRepositoryHistory,
  emit: (
    batch: RepositoryHistoryBatch,
  ) => Effect.Effect<void, RepositoryHistoryError>,
  readObjectFormat: ObjectFormatRead,
): Effect.Effect<number, RepositoryHistoryError | RepositoryGitError> {
  return Effect.gen(function* () {
    let sequence =
      request.basis?._tag === "Incomplete"
        ? request.basis.nextBatchSequence
        : 0;
    const nextSequence = Effect.suspend(() =>
      sequence >= maximumRepositoryHistorySequence
        ? Effect.fail(
            historyFailed("Repository history batch sequence is exhausted"),
          )
        : Effect.succeed(sequence++),
    );
    let commitCount =
      request.basis?._tag === "Incomplete"
        ? request.basis.committedCommitCount
        : request.basis?._tag === "Complete"
          ? request.basis.commitCount
          : 0;
    let captured = yield* initialSnapshot(
      git,
      repositoryPath,
      request.basis,
      readObjectFormat,
    );

    if (request.basis?._tag === "Incomplete") {
      commitCount += yield* streamHistory(
        git,
        repositoryPath,
        request,
        request.basis.rootOids,
        [],
        request.basis.committedCommitCount,
        request.basis.objectFormat,
        nextSequence,
        emit,
        true,
        captured.shallowOids ?? [],
      );
    } else {
      const snapshotSequence = yield* nextSequence;
      yield* emitSnapshot(
        request,
        captured,
        request.basis === undefined,
        snapshotSequence,
        emit,
      );
      commitCount += yield* streamHistory(
        git,
        repositoryPath,
        request,
        captured.rootOids,
        request.basis?._tag === "Complete" ? request.basis.rootOids : [],
        0,
        captured.objectFormat,
        nextSequence,
        emit,
        request.basis?._tag === "Complete",
        captured.shallowOids ?? [],
      );
    }

    for (let pass = 0; pass < maximumReconciliationPasses; pass += 1) {
      const latest = yield* readRepositoryHistorySnapshot(
        git,
        repositoryPath,
        readObjectFormat,
      );
      if (!sameShallowBoundaries(captured.shallowOids, latest.shallowOids))
        return yield* Effect.fail(snapshotInvalidated());
      if (latest.id === captured.id) {
        return commitCount;
      }
      const snapshotSequence = yield* nextSequence;
      yield* emitSnapshot(request, latest, false, snapshotSequence, emit);
      commitCount += yield* streamHistory(
        git,
        repositoryPath,
        request,
        latest.rootOids,
        captured.rootOids,
        0,
        latest.objectFormat,
        nextSequence,
        emit,
        true,
        latest.shallowOids ?? [],
      );
      captured = latest;
    }
    return yield* Effect.fail(
      historyFailed(
        "Repository refs did not settle during history synchronization",
      ),
    );
  });
}

function initialSnapshot(
  git: GitCommandRunner,
  repositoryPath: string,
  basis: SynchronizationBasis | undefined,
  readObjectFormat: ObjectFormatRead,
) {
  return Effect.gen(function* () {
    const current = yield* readRepositoryHistorySnapshot(
      git,
      repositoryPath,
      readObjectFormat,
    );
    if (
      basis !== undefined &&
      !sameShallowBoundaries(basis.shallowOids, current.shallowOids)
    )
      return yield* Effect.fail(snapshotInvalidated());
    if (basis?._tag !== "Incomplete") return current;
    if (
      !basis.snapshotId.startsWith(
        historyTraversalIdentity(
          basis.objectFormat,
          basis.rootOids,
          basis.shallowOids ?? [],
        ),
      )
    )
      return yield* Effect.fail(snapshotInvalidated());
    return {
      id: basis.snapshotId,
      objectFormat: basis.objectFormat,
      refTargets: [],
      resumable: true,
      rootOids: basis.rootOids,
      shallowOids: basis.shallowOids ?? [],
    } satisfies RepositoryHistorySnapshot;
  });
}

function sameShallowBoundaries(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((oid, index) => oid === right[index])
  );
}

function emitSnapshot(
  request: SynchronizeRepositoryHistory,
  snapshot: RepositoryHistorySnapshot,
  resumable: boolean,
  sequence: number,
  emit: (
    batch: RepositoryHistoryBatch,
  ) => Effect.Effect<void, RepositoryHistoryError>,
) {
  return emit({
    commits: [],
    objectFormat: snapshot.objectFormat,
    repositoryId: request.repositoryId,
    requestId: request.requestId,
    sequence,
    snapshot: { ...snapshot, resumable },
  });
}

function streamHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: SynchronizeRepositoryHistory,
  roots: readonly string[],
  excludedRoots: readonly string[],
  skip: number,
  objectFormat: GitObjectFormat,
  nextSequence: Effect.Effect<number, RepositoryHistoryError>,
  emit: (
    batch: RepositoryHistoryBatch,
  ) => Effect.Effect<void, RepositoryHistoryError>,
  invalidBasisOnFailure: boolean,
  shallowOids: readonly string[],
) {
  return streamRepositoryHistory(
    git,
    repositoryPath,
    {
      roots,
      excludedRoots,
      skip,
      objectFormat,
      shallowOids,
      invalidBasisOnFailure,
    },
    (commits) =>
      nextSequence.pipe(
        Effect.flatMap((sequence) =>
          emit({
            commits,
            objectFormat,
            repositoryId: request.repositoryId,
            requestId: request.requestId,
            sequence,
          }),
        ),
      ),
  );
}
