import { Effect } from "effect";
import type { RepositoryHistoryFailure } from "#contracts/repository-history/repository-history.contract.ts";
import {
  cacheByGitEntry,
  type GitCommandRunner,
  type GitObjectFormat,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import { historyFailed } from "#server/features/repository-history/git/history-failures.ts";

export interface HistoryLayout {
  readonly objectFormat: GitObjectFormat;
  readonly shallowFile: string;
}

export type HistoryLayoutRead = Effect.Effect<
  HistoryLayout,
  RepositoryHistoryFailure
>;

export function createHistoryLayoutCache(git: GitCommandRunner) {
  const layouts = cacheByGitEntry((repositoryPath) =>
    readHistoryLayout(git, repositoryPath),
  );
  return layouts.read;
}

function readHistoryLayout(
  git: GitCommandRunner,
  repositoryPath: string,
): HistoryLayoutRead {
  return runRepositoryGit(git, repositoryPath, [
    "rev-parse",
    "--show-object-format",
    "--path-format=absolute",
    "--git-path",
    "shallow",
  ]).pipe(
    Effect.flatMap((output) => {
      const [objectFormat, shallowFile] = output.trimEnd().split("\n");
      if (objectFormat !== "sha1" && objectFormat !== "sha256")
        return Effect.fail(
          historyFailed(`Unsupported Git object format: ${objectFormat}`),
        );
      if (!shallowFile)
        return Effect.fail(
          historyFailed("Could not read shallow repository history"),
        );
      return Effect.succeed({ objectFormat, shallowFile });
    }),
  );
}
