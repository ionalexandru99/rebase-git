import type {
  RepositoryHistoryBatch,
  SynchronizeRepositoryHistory,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import {
  createGitHistoryBatchParser,
  gitHistoryFormat,
} from "#server/features/repository-history/git/parse-git-history";

const batchSize = 256;
const maximumBatchCharacters = 4 * 1_048_576;
const maximumStashRootsBytes = 16 * 1_024;
const synchronizationTimeoutMilliseconds = 30 * 60_000;

export function synchronizeRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: SynchronizeRepositoryHistory,
  emit: (
    batch: RepositoryHistoryBatch,
  ) => Effect.Effect<void, RepositoryHistoryError>,
): Effect.Effect<number, RepositoryHistoryError> {
  return Effect.gen(function* () {
    const stream = git.stream;
    if (stream === undefined) {
      return yield* gitFailure("Git history streaming is unavailable");
    }
    const [formatOutput, stashTipOutput, worktreesOutput] = yield* Effect.all(
      [
        runGit(git, repositoryPath, ["rev-parse", "--show-object-format"]),
        runGit(git, repositoryPath, [
          "for-each-ref",
          "--format=%(objectname)",
          "refs/stash",
        ]),
        runGit(git, repositoryPath, ["worktree", "list", "--porcelain", "-z"]),
      ],
      { concurrency: "unbounded" },
    );
    const stashOutput =
      stashTipOutput.trim() === ""
        ? ""
        : yield* runGit(
            git,
            repositoryPath,
            ["reflog", "show", "--format=%H", "refs/stash"],
            maximumStashRootsBytes,
          );
    const objectFormat = yield* parseOutput(() =>
      parseObjectFormat(formatOutput),
    );
    const additionalRoots = additionalHistoryRoots(
      stashOutput,
      worktreesOutput,
      objectFormat,
    );
    let sequence = 0;
    let emitFailure: RepositoryHistoryError | undefined;
    let streamSignal: AbortSignal | undefined;
    const parser = createGitHistoryBatchParser(
      objectFormat,
      batchSize,
      (commits) =>
        Effect.runPromise(
          emit({
            commits,
            objectFormat,
            repositoryId: request.repositoryId,
            requestId: request.requestId,
            sequence: sequence++,
          }).pipe(
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
    const output = yield* stream(
      {
        arguments: [
          "log",
          "--topo-order",
          "--no-show-signature",
          `--format=${gitHistoryFormat}`,
          "-z",
          "--branches",
          "--remotes",
          "--tags",
          "--end-of-options",
          ...additionalRoots,
          "--",
        ],
        directory: repositoryPath,
        timeoutMilliseconds: synchronizationTimeoutMilliseconds,
      },
      (chunk, signal) => {
        streamSignal = signal;
        return parser.accept(chunk);
      },
    ).pipe(
      Effect.mapError((cause) =>
        emitFailure === undefined ? repositoryHistoryError(cause) : emitFailure,
      ),
    );
    if (output.exitCode !== 0) {
      return yield* gitFailure(output.stderr.slice(0, 2_048));
    }
    return yield* parseOutput((signal) => {
      streamSignal = signal;
      return parser.finish();
    }).pipe(Effect.mapError((failure) => emitFailure ?? failure));
  });
}

function additionalHistoryRoots(
  stashOutput: string,
  worktreesOutput: string,
  objectFormat: "sha1" | "sha256",
) {
  const roots = new Set<string>();
  for (const line of stashOutput.split("\n")) {
    addOid(roots, line.trim(), objectFormat);
  }
  for (const field of worktreesOutput.split("\0")) {
    if (field.startsWith("HEAD ")) {
      addOid(roots, field.slice(5), objectFormat);
    }
  }
  return [...roots];
}

function addOid(
  roots: Set<string>,
  oid: string,
  objectFormat: "sha1" | "sha256",
) {
  const length = objectFormat === "sha1" ? 40 : 64;
  if (oid.length === length && /^[0-9a-f]+$/.test(oid)) {
    roots.add(oid);
  }
}

function parseObjectFormat(output: string) {
  const format = output.trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new Error(`Unsupported Git object format: ${format}`);
  }
  return format;
}

function runGit(
  git: GitCommandRunner,
  directory: string,
  arguments_: readonly string[],
  maxOutputBytes?: number,
) {
  return git
    .run({
      arguments: arguments_,
      directory,
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
      timeoutMilliseconds: 30_000,
    })
    .pipe(
      Effect.mapError(repositoryHistoryError),
      Effect.flatMap((output) =>
        output.exitCode === 0
          ? Effect.succeed(output.stdout)
          : gitFailure(output.stderr.slice(0, 2_048)),
      ),
    );
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

function gitFailure(detail: string) {
  return Effect.fail(
    new RepositoryHistoryError({
      failure: { _tag: "GitFailed", detail, reason: "Failed" },
    }),
  );
}
