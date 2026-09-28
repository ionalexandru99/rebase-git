import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import type {
  OperationFailure,
  OperationStarted,
  RepositoryOperation,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type GitCommandOutput,
  type GitCommandRunner,
  runRepositoryGit,
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
  if (/would be overwritten by merge/i.test(detail))
    return Effect.fail({
      ...operationError("WouldOverwrite", detail),
      paths: detail
        .split("\n")
        .filter((line) => line.startsWith("\t"))
        .map((line) => line.trim())
        .filter((path) => path.length > 0)
        .slice(0, 100),
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

export function uncertain() {
  return operationError(
    "Uncertain",
    "Git's result could not be confirmed. Refresh the worktree before trying again.",
  );
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
