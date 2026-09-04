import type {
  ReadRepositoryHistory,
  RepositoryHistoryPage,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "#server/features/repository-history/git/parse-git-history";
import {
  readShallowHistoryOids,
  restoreShallowCommitParents,
} from "#server/features/repository-history/git/shallow-repository-history";

const maximumHistoryOutputBytes = 8 * 1_048_576;
const historyTimeoutMilliseconds = 30_000;

export function readRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: ReadRepositoryHistory,
): Effect.Effect<RepositoryHistoryPage, RepositoryHistoryError> {
  return Effect.gen(function* () {
    const formatOutput = yield* runGit(git, repositoryPath, [
      "rev-parse",
      "--show-object-format",
    ]);
    const objectFormat = yield* parseHistoryOutput(() =>
      parseObjectFormat(formatOutput),
    );
    const historyOutput = yield* runGit(
      git,
      repositoryPath,
      [
        "log",
        request.order === "topological" ? "--topo-order" : "--date-order",
        "--no-show-signature",
        `--max-count=${request.limit}`,
        `--format=${gitHistoryFormat}`,
        "-z",
        "--end-of-options",
        ...request.roots.map((root) => root.oid),
        "--",
      ],
      maximumHistoryOutputBytes,
    );
    const parsed = yield* parseHistoryOutput(() =>
      parseGitHistory(historyOutput, objectFormat),
    );
    const shallowOids = yield* readShallowHistoryOids(git, repositoryPath);
    const commits = yield* restoreShallowCommitParents(
      git,
      repositoryPath,
      parsed,
      new Set(shallowOids),
    );
    return {
      commits,
      objectFormat,
      refTargets: request.roots,
      repositoryId: request.repositoryId,
      requestId: request.requestId,
    };
  });
}

function parseHistoryOutput<T>(parse: () => T) {
  return Effect.try({
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
    try: parse,
  });
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
      timeoutMilliseconds: historyTimeoutMilliseconds,
    })
    .pipe(
      Effect.mapError(
        (error) =>
          new RepositoryHistoryError({
            cause: error,
            failure: { _tag: "GitFailed", reason: error.reason },
          }),
      ),
      Effect.flatMap((output) =>
        output.exitCode === 0
          ? Effect.succeed(output.stdout)
          : Effect.fail(
              new RepositoryHistoryError({
                failure: {
                  _tag: "GitFailed",
                  detail: output.stderr.slice(0, 2_048),
                  reason: "Failed",
                },
              }),
            ),
      ),
    );
}

function parseObjectFormat(output: string) {
  const format = output.trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new Error(`Unsupported Git object format: ${format}`);
  }
  return format;
}
