import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  OperationFailure,
  OperationStarted,
  RepositoryOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { uninterruptible } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommand,
  type GitCommandOutput,
  type GitCommandRunner,
  type GitFailed,
  isGitFailed,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";
import { rejectionFromGit } from "#server/repository/git-rejection.ts";

export function started(
  outcome: OperationStarted["outcome"],
  operation: RepositoryOperation,
): OperationStarted {
  return { outcome, operation };
}

export async function readCommit(
  git: GitCommandRunner,
  directory: string,
  rev: string,
) {
  return (
    await runRepositoryGit(
      git,
      directory,
      [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${rev}^{commit}`,
      ],
      { exitCodes: [0, 1] },
    )
  ).trim();
}

export function isGitLocked(detail: string) {
  return /\.lock['\s:]|another git process/i.test(detail);
}

export function requireGitSuccess(output: GitCommandOutput) {
  if (output.exitCode === 0) return;
  const detail =
    output.stderr ||
    output.stdout ||
    "Git rejected the action. Check the worktree and configured hooks.";
  if (isGitLocked(detail)) throw repositoryRejected("Busy", detail);
  const rejection = rejectionFromGit(detail);
  if (rejection.reason !== "GitFailed") throw rejection;
  if (/would be overwritten by (?:merge|checkout)/i.test(detail))
    throw {
      ...operationError("WouldOverwrite", detail),
      paths: overwrittenPaths(detail),
    };
  throw operationError(
    /hook|pre-commit|commit-msg|pre-rebase|not committing merge/i.test(detail)
      ? "HookFailed"
      : "GitRejected",
    detail,
  );
}

export function overwrittenPaths(detail: string) {
  return detail
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.trim())
    .filter((path) => path.length > 0)
    .slice(0, 100);
}

export type GitExit =
  | { readonly _tag: "Success"; readonly output: GitCommandOutput }
  | { readonly _tag: "Failure"; readonly failure: GitFailed };

export async function runChange(
  git: GitCommandRunner,
  command: GitCommand,
): Promise<GitExit> {
  try {
    return {
      _tag: "Success",
      output: await uninterruptible(() => git.run(command)),
    };
  } catch (error) {
    if (!isGitFailed(error)) throw error;
    return { _tag: "Failure", failure: error };
  }
}

export function exitCodeOf(exit: GitExit) {
  return exit._tag === "Success" ? exit.output.exitCode : undefined;
}

export async function requireLanded(
  exit: GitExit,
  landed: () => Promise<boolean>,
) {
  if (exit._tag === "Success") return requireGitSuccess(exit.output);
  if (!(await landed())) throw exit.failure;
}

export async function headMoved(
  git: GitCommandRunner,
  directory: string,
  from: string,
) {
  return (await readCommit(git, directory, "HEAD")) !== from;
}

export async function hasStagedChanges(
  git: GitCommandRunner,
  directory: string,
) {
  const { exitCode } = await runRepositoryGitOutput(
    git,
    directory,
    ["diff", "--cached", "--quiet"],
    { exitCodes: [0, 1] },
  );
  return exitCode === 1;
}

export function operationError(
  reason: OperationFailure["reason"],
  detail: string,
): OperationFailure {
  return { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) };
}
