import type {
  RepositoryHistoryBatch,
  RepositoryHistorySnapshot,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { maximumRepositoryHistorySequence } from "@rebase/contracts/repository-history/repository-history-limits.contract";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { historyTraversalIdentity } from "#server/features/repository-history/git/history-snapshot-identity";
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
): Effect.Effect<number, RepositoryHistoryError> {
  return Effect.gen(function* () {
    if (git.stream === undefined) {
      return yield* gitFailure("Git history streaming is unavailable");
    }
    let sequence =
      request.basis?._tag === "Incomplete"
        ? request.basis.nextBatchSequence
        : 0;
    const nextSequence = () => {
      if (sequence >= maximumRepositoryHistorySequence) {
        throw new RepositoryHistoryError({
          failure: {
            _tag: "GitFailed",
            detail: "Repository history batch sequence is exhausted",
            reason: "Failed",
          },
        });
      }
      const current = sequence;
      sequence += 1;
      return current;
    };
    let commitCount =
      request.basis?._tag === "Incomplete"
        ? request.basis.committedCommitCount
        : request.basis?._tag === "Complete"
          ? request.basis.commitCount
          : 0;
    let captured = yield* initialSnapshot(git, repositoryPath, request.basis);

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
      const snapshotSequence = yield* takeSequence(nextSequence);
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
      const latest = yield* readRepositoryHistorySnapshot(git, repositoryPath);
      if (!sameShallowBoundaries(captured.shallowOids, latest.shallowOids))
        return yield* snapshotInvalidated();
      if (latest.id === captured.id) {
        return commitCount;
      }
      const snapshotSequence = yield* takeSequence(nextSequence);
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
    return yield* gitFailure(
      "Repository refs did not settle during history synchronization",
    );
  });
}

function initialSnapshot(
  git: GitCommandRunner,
  repositoryPath: string,
  basis: SynchronizationBasis | undefined,
) {
  return Effect.gen(function* () {
    const current = yield* readRepositoryHistorySnapshot(git, repositoryPath);
    if (
      basis !== undefined &&
      !sameShallowBoundaries(basis.shallowOids, current.shallowOids)
    )
      return yield* snapshotInvalidated();
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
      return yield* snapshotInvalidated();
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
  objectFormat: "sha1" | "sha256",
  nextSequence: () => number,
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
      takeSequence(nextSequence).pipe(
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

function takeSequence(nextSequence: () => number) {
  return Effect.try({
    try: nextSequence,
    catch: repositoryHistoryError,
  });
}

function repositoryHistoryError(cause: unknown) {
  if (cause instanceof RepositoryHistoryError) {
    return cause;
  }
  const reason =
    typeof cause === "object" &&
    cause !== null &&
    "reason" in cause &&
    (cause.reason === "GitUnavailable" ||
      cause.reason === "Timeout" ||
      cause.reason === "OutputTooLarge" ||
      cause.reason === "Failed")
      ? cause.reason
      : "Failed";
  return new RepositoryHistoryError({
    cause,
    failure: { _tag: "GitFailed", reason },
  });
}

function snapshotInvalidated() {
  return Effect.fail(
    new RepositoryHistoryError({ failure: { _tag: "SnapshotInvalidated" } }),
  );
}

function gitFailure(detail: string) {
  return Effect.fail(
    new RepositoryHistoryError({
      failure: { _tag: "GitFailed", detail, reason: "Failed" },
    }),
  );
}
