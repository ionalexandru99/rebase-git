import type {
  ReadRepositoryHistory,
  RepositoryHistoryPage,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { RepositoryHistoryError } from "#server/domain/repository-history.contract";
import { historyGit } from "#server/features/repository-history/git/history-git";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "#server/features/repository-history/git/parse-git-history";
import {
  maximumHistoryOutputBytes,
  readSelectedHistory,
} from "#server/features/repository-history/git/read-selected-history";
import {
  readShallowHistoryOids,
  restoreShallowCommitParents,
} from "#server/features/repository-history/git/shallow-repository-history";

export function readRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: ReadRepositoryHistory,
): Effect.Effect<RepositoryHistoryPage, RepositoryHistoryError> {
  return Effect.gen(function* () {
    const formatOutput = yield* historyGit(git, repositoryPath, [
      "rev-parse",
      "--show-object-format",
    ]);
    const objectFormat = yield* parseHistoryOutput(() =>
      parseObjectFormat(formatOutput),
    );
    const historyOutput = yield* request.ancestry === "first-parent"
      ? readSelectedHistory(git, repositoryPath, request)
      : historyGit(
          git,
          repositoryPath,
          [
            "log",
            request.order === "topological" ? "--topo-order" : "--date-order",
            "--no-show-signature",
            `--skip=${request.offset ?? 0}`,
            `--max-count=${request.limit}`,
            `--format=${gitHistoryFormat}`,
            "-z",
            "--end-of-options",
            ...request.roots.map((root) => root.oid),
            "--",
          ],
          { maxOutputBytes: maximumHistoryOutputBytes },
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

function parseObjectFormat(output: string) {
  const format = output.trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new Error(`Unsupported Git object format: ${format}`);
  }
  return format;
}
