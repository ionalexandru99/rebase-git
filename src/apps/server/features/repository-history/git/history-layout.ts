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

export type HistoryLayoutRead = (
  repositoryPath: string,
) => Promise<HistoryLayout>;

export function createHistoryLayoutCache(
  git: GitCommandRunner,
): HistoryLayoutRead {
  const layouts = cacheByGitEntry((repositoryPath) =>
    readHistoryLayout(git, repositoryPath),
  );
  return layouts.read;
}

async function readHistoryLayout(
  git: GitCommandRunner,
  repositoryPath: string,
): Promise<HistoryLayout> {
  const output = await runRepositoryGit(git, repositoryPath, [
    "rev-parse",
    "--show-object-format",
    "--path-format=absolute",
    "--git-path",
    "shallow",
  ]);
  const [objectFormat, shallowFile] = output.trimEnd().split("\n");
  if (objectFormat !== "sha1" && objectFormat !== "sha256")
    throw historyFailed(`Unsupported Git object format: ${objectFormat}`);
  if (!shallowFile)
    throw historyFailed("Could not read shallow repository history");
  return { objectFormat, shallowFile };
}
