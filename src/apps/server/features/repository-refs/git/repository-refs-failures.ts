import type { RepositoryRefsOperationFailure } from "@rebase/contracts";
import { Effect } from "effect";
import type {
  GitCommandError,
  GitCommandOutput,
} from "#server/domain/git-command.contract";
import { RepositoryRefsError } from "#server/domain/repository-refs.contract";

const maximumDetailLength = 2_048;

export function repositoryRefsFailure(
  failure: RepositoryRefsOperationFailure,
  cause?: unknown,
) {
  return new RepositoryRefsError({
    ...(cause === undefined ? {} : { cause }),
    failure,
  });
}

export function gitCommandFailed(error: GitCommandError) {
  return repositoryRefsFailure(
    { _tag: "GitFailed", reason: error.reason },
    error,
  );
}

export function gitOutputFailed(output: GitCommandOutput) {
  return repositoryRefsFailure({
    _tag: "GitFailed",
    detail: failureDetail(output.stderr),
    reason: /not a git repository/i.test(output.stderr)
      ? "NotRepository"
      : "Failed",
  });
}

export function requireSuccessfulOutput(output: GitCommandOutput) {
  return output.exitCode === 0
    ? Effect.succeed(output)
    : Effect.fail(gitOutputFailed(output));
}

export function checkoutFailure(
  stderr: string,
  targetName: string,
): RepositoryRefsError {
  const elsewhere =
    /already (?:checked out|used by worktree) at '([^']+)'/.exec(stderr);
  if (elsewhere?.[1] !== undefined) {
    return repositoryRefsFailure({
      _tag: "BranchCheckedOutElsewhere",
      name: targetName,
      worktreePath: elsewhere[1],
    });
  }
  if (
    /did not match any file\(s\) known to git|invalid reference|is not a commit and a branch/i.test(
      stderr,
    )
  ) {
    return repositoryRefsFailure({ _tag: "RefMissing", name: targetName });
  }
  if (/would be overwritten by checkout/i.test(stderr)) {
    return repositoryRefsFailure({
      _tag: "CheckoutRejected",
      detail: failureDetail(stderr),
      reason: "LocalChanges",
    });
  }
  return repositoryRefsFailure({
    _tag: "GitFailed",
    detail: failureDetail(stderr),
    reason: "Failed",
  });
}

export function failureDetail(stderr: string) {
  return stderr.trim().slice(0, maximumDetailLength);
}
