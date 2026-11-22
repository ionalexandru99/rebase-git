import { tmpdir } from "node:os";
import {
  type GitCommandRunner,
  isGitFailed,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";

const minimumGitVersion = [2, 35, 0] as const;

export async function verifyGitVersion(git: GitCommandRunner) {
  const version = parseGitVersion(await readGitVersion(git));
  if (compareVersions(version, minimumGitVersion) < 0)
    throw new Error(
      `Git 2.35 or newer is required. Found Git ${version.join(".")}.`,
    );
}

async function readGitVersion(git: GitCommandRunner) {
  try {
    return await runRepositoryGit(git, tmpdir(), ["--version"]);
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    throw new Error(
      error.reason === "GitUnavailable"
        ? "Git 2.35 or newer is required, but Git was not found."
        : `Could not run Git: ${error.detail}`,
      { cause: error },
    );
  }
}

function parseGitVersion(output: string) {
  const match = /^git version (\d+)\.(\d+)\.(\d+)/i.exec(output);
  if (!match?.[1] || !match[2] || !match[3])
    throw new Error(
      `Could not determine the Git version from "${output.trim()}".`,
    );
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
) {
  for (const index of [0, 1, 2] as const) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}
