import { Effect, Stream } from "effect";
import type {
  GitCommandError,
  GitCommandOptions,
  GitCommandRunner,
  GitStreamOptions,
} from "#server/domain/git-command.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";

const maximumDetailLength = 2_048;

export interface RepositoryGitOptions extends GitCommandOptions {
  readonly exitCodes?: readonly number[];
}

export function runRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  { exitCodes = [0], ...options }: RepositoryGitOptions = {},
) {
  return git.run({ ...options, directory, arguments: args }).pipe(
    Effect.mapError(repositoryGitError),
    Effect.flatMap((output) =>
      exitCodes.includes(output.exitCode)
        ? Effect.succeed(output.stdout)
        : Effect.fail(rejectedByGit(output.exitCode, output.stderr)),
    ),
  );
}

export function streamRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: GitStreamOptions = {},
) {
  return git
    .stream({ ...options, directory, arguments: args })
    .pipe(Stream.mapError(repositoryGitError));
}

export function isGitRejection(error: RepositoryGitError) {
  return error.exitCode !== undefined;
}

function repositoryGitError(error: GitCommandError) {
  return error.exitCode === undefined
    ? new RepositoryGitError({
        cause: error,
        detail: `Git could not complete the operation (${error.reason}).`,
        reason: error.reason,
      })
    : rejectedByGit(error.exitCode, error.stderr ?? "");
}

function rejectedByGit(exitCode: number, stderr: string) {
  return new RepositoryGitError({
    detail:
      stderr.trim().slice(0, maximumDetailLength) ||
      "Git rejected the operation.",
    exitCode,
    reason: "Failed",
  });
}
