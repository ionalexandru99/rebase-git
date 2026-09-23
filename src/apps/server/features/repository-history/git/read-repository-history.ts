import type {
  ReadRepositoryHistory,
  RepositoryHistoryPage,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  parseHistoryOutput,
  type RepositoryHistoryError,
} from "#server/features/repository-history/git/history-failures";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "#server/features/repository-history/git/parse-git-history";
import { readObjectFormat } from "#server/features/repository-history/git/read-object-format";
import {
  maximumHistoryOutputBytes,
  readSelectedHistory,
} from "#server/features/repository-history/git/read-selected-history";
import {
  readShallowHistoryOids,
  restoreShallowCommitParents,
} from "#server/features/repository-history/git/shallow-repository-history";
import { runRepositoryGit } from "#server/repository/access/index";

export function readRepositoryHistory(
  git: GitCommandRunner,
  repositoryPath: string,
  request: ReadRepositoryHistory,
): Effect.Effect<
  RepositoryHistoryPage,
  RepositoryHistoryError | RepositoryGitError
> {
  return Effect.gen(function* () {
    const objectFormat = yield* readObjectFormat(git, repositoryPath);
    const historyOutput = yield* request.ancestry === "first-parent"
      ? readSelectedHistory(git, repositoryPath, request)
      : runRepositoryGit(
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
