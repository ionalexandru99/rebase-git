import {
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

export const refCommand = {
  literalPathspecs: false,
  timeoutMilliseconds: 30_000,
};

export async function requireValidRefName(
  git: GitCommandRunner,
  directory: string,
  fullRef: string,
  invalid: unknown,
) {
  try {
    await runRepositoryGit(
      git,
      directory,
      ["check-ref-format", fullRef],
      refCommand,
    );
  } catch (error) {
    throw isGitRejected(error) ? invalid : error;
  }
}

export async function readRefTarget(
  git: GitCommandRunner,
  directory: string,
  revision: string,
) {
  const output = await runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", revision],
    { ...refCommand, exitCodes: [0, 1] },
  );
  return output.trim() || undefined;
}

export function isGitRejected(error: unknown): error is GitFailed {
  return isGitFailed(error) && isGitRejection(error);
}
