import { Effect } from "effect";
import type {
  GitCommand,
  GitCommandRunner,
} from "#server/domain/git-command.contract";
import { runRepositoryGit } from "#server/features/repository-access/run-repository-git";

export function readGitCommonDirectory(
  git: GitCommandRunner,
  directory: string,
  options: Partial<GitCommand> = {},
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options,
  ).pipe(Effect.map((output) => output.trim()));
}
