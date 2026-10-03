import { Effect, Result } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  OperationFailure,
  OperationStarted,
  RepositoryOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommand,
  type GitCommandOutput,
  type GitCommandRunner,
  type GitFailed,
  isIdentityMissing,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";

export function started(
  outcome: OperationStarted["outcome"],
  operation: RepositoryOperation,
): OperationStarted {
  return { outcome, operation };
}

export function readCommit(
  git: GitCommandRunner,
  directory: string,
  rev: string,
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map((output) => output.trim()));
}

export function requireGitSuccess(output: GitCommandOutput) {
  if (output.exitCode === 0) return Effect.void;
  const detail =
    output.stderr ||
    output.stdout ||
    "Git rejected the action. Check the worktree and configured hooks.";
  if (/\.lock['\s:]|another git process/i.test(detail))
    return Effect.fail(repositoryRejected("Busy", detail));
  if (isIdentityMissing(detail))
    return Effect.fail(
      repositoryRejected(
        "IdentityMissing",
        "Add your name and email to commit.",
      ),
    );
  if (/would be overwritten by (?:merge|checkout)/i.test(detail))
    return Effect.fail({
      ...operationError("WouldOverwrite", detail),
      paths: overwrittenPaths(detail),
    });
  return Effect.fail(
    operationError(
      /hook|pre-commit|commit-msg|pre-rebase|not committing merge/i.test(detail)
        ? "HookFailed"
        : "GitRejected",
      detail,
    ),
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

export type GitExit = Result.Result<GitCommandOutput, GitFailed>;

export function runChange(git: GitCommandRunner, command: GitCommand) {
  return Effect.result(git.run(command)).pipe(Effect.uninterruptible);
}

export function requireLanded<E>(
  exit: GitExit,
  landed: Effect.Effect<boolean, E>,
) {
  if (Result.isSuccess(exit)) return requireGitSuccess(exit.success);
  return Effect.flatMap(landed, (yes) =>
    yes ? Effect.void : Effect.fail(exit.failure),
  );
}

export function headMoved(
  git: GitCommandRunner,
  directory: string,
  from: string,
) {
  return readCommit(git, directory, "HEAD").pipe(
    Effect.map((head) => head !== from),
  );
}

export function hasStagedChanges(git: GitCommandRunner, directory: string) {
  return runRepositoryGitOutput(
    git,
    directory,
    ["diff", "--cached", "--quiet"],
    { exitCodes: [0, 1] },
  ).pipe(Effect.map(({ exitCode }) => exitCode === 1));
}

export function operationFailure(
  reason: OperationFailure["reason"],
  detail: string,
) {
  return Effect.fail(operationError(reason, detail));
}

export function operationError(
  reason: OperationFailure["reason"],
  detail: string,
): OperationFailure {
  return { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) };
}
