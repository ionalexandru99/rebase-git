import type {
  ReadRepositoryHistory,
  RepositoryHistoryOperationFailure,
  RepositoryHistoryPage,
} from "@rebase/contracts";
import { Effect } from "effect";
import {
  type GitCommandRunner,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands";
import { parseHistoryOutput } from "#server/features/repository-history/git/history-failures";
import {
  gitHistoryFormat,
  parseGitHistory,
} from "#server/features/repository-history/git/parse-git-history";
import type { ObjectFormatRead } from "#server/features/repository-history/git/read-object-format";
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
  readObjectFormat: ObjectFormatRead,
): Effect.Effect<RepositoryHistoryPage, RepositoryHistoryOperationFailure> {
  return Effect.gen(function* () {
    const objectFormat = yield* readObjectFormat;
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
