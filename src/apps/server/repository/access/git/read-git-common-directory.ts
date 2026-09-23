import { Effect } from "effect";
import type {
  GitCommandOptions,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { runRepositoryGit } from "#server/repository/access/run-repository-git";

export function readGitCommonDirectory(
  git: GitCommandRunner,
  directory: string,
  options: GitCommandOptions = {},
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options,
  ).pipe(Effect.map((output) => output.trim()));
}
