import type {
  RepositoryHistoryBatch,
  RepositoryHistorySnapshot,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { maximumRepositoryHistorySequence } from "@rebase/contracts/repository-history/repository-history-limits.contract";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history";
import { readRepositoryHistorySnapshot } from "#server/features/repository-history/git/read-repository-history-snapshot";

const batchSize = 256;
const maximumBatchCharacters = 4 * 1_048_576;
const maximumReconciliationPasses = 8;
const synchronizationTimeoutMilliseconds = 30 * 60_000;

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
      );
    }

    for (let pass = 0; pass < maximumReconciliationPasses; pass += 1) {
      const latest = yield* readRepositoryHistorySnapshot(git, repositoryPath);
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
  if (basis?._tag !== "Incomplete") {
    return readRepositoryHistorySnapshot(git, repositoryPath);
  }
  return Effect.succeed({
    id: basis.snapshotId,
    objectFormat: basis.objectFormat,
    refTargets: [],
    resumable: true,
    rootOids: basis.rootOids,
  } satisfies RepositoryHistorySnapshot);
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
) {
  if (roots.length === 0) {
    return Effect.succeed(0);
  }
  const stream = git.stream;
  if (stream === undefined) {
    return gitFailure("Git history streaming is unavailable");
  }
  let emitFailure: RepositoryHistoryError | undefined;
  let streamSignal: AbortSignal | undefined;
  const parser = createGitHistoryBatchParser(
    objectFormat,
    batchSize,
    (commits) =>
      Effect.runPromise(
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
          Effect.tapError((failure) =>
            Effect.sync(() => {
              emitFailure = failure;
            }),
          ),
        ),
        streamSignal === undefined ? undefined : { signal: streamSignal },
      ),
    maximumBatchCharacters,
  );
  return stream(
    {
      arguments: [
        "log",
        "--stdin",
        "--topo-order",
        "--no-show-signature",
        ...(skip === 0 ? [] : [`--skip=${skip}`]),
        `--format=${gitHistoryFormat}`,
        "-z",
        "--",
      ],
      directory: repositoryPath,
      input: historyInput(roots, excludedRoots),
      timeoutMilliseconds: synchronizationTimeoutMilliseconds,
    },
    (chunk, signal) => {
      streamSignal = signal;
      return parser.accept(chunk);
    },
  ).pipe(
    Effect.mapError((cause) => emitFailure ?? repositoryHistoryError(cause)),
    Effect.flatMap((output) =>
      output.exitCode === 0
        ? parseOutput((signal) => {
            streamSignal = signal;
            return parser.finish();
          }).pipe(Effect.mapError((failure) => emitFailure ?? failure))
        : invalidBasisOnFailure
          ? snapshotInvalidated()
          : gitFailure(output.stderr.slice(0, 2_048)),
    ),
  );
}

function historyInput(
  roots: readonly string[],
  excludedRoots: readonly string[],
) {
  return `${roots.join("\n")}\n${excludedRoots.map((oid) => `^${oid}`).join("\n")}\n`;
}

function parseOutput<T>(parse: (signal: AbortSignal) => T | Promise<T>) {
  return Effect.tryPromise({
    try: async (signal) => parse(signal),
    catch: (cause) =>
      new RepositoryHistoryError({
        cause,
        failure: {
          _tag: "GitFailed",
          detail:
            cause instanceof Error ? cause.message.slice(0, 2_048) : undefined,
          reason: "Failed",
        },
      }),
  });
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
