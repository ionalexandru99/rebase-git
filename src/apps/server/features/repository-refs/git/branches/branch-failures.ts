import type { RepositoryBranchesOperationFailure } from "@rebase/contracts";
import { Data } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { RepositoryAccessError } from "#server/domain/repository-access.contract";
import type { RepositoryCoordinationError } from "#server/domain/repository-coordination.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import {
  gitFailed,
  type RepositoryRefsError,
  repositoryAccessFailed,
} from "#server/features/repository-refs/git/repository-refs-failures";
import { isGitRejection } from "#server/repository/access/index";

export class RepositoryBranchesError extends Data.TaggedError(
  "RepositoryBranchesError",
)<{
  readonly cause?: unknown;
  readonly failure: RepositoryBranchesOperationFailure;
}> {}

export function branchesFailure(
  failure: RepositoryBranchesOperationFailure,
  cause?: unknown,
) {
  return new RepositoryBranchesError({
    ...(cause === undefined ? {} : { cause }),
    failure,
  });
}

export function branchAccessFailed(
  error: RepositoryAccessError | EnvironmentStorageError,
) {
  const failed = repositoryAccessFailed(error);
  return failed._tag === "EnvironmentStorageError"
    ? failed
    : fromRefsError(failed);
}

export function branchGitFailed(error: RepositoryGitError) {
  return fromRefsError(gitFailed(error));
}

export function branchCoordinationFailed(error: RepositoryCoordinationError) {
  return branchesFailure({
    _tag: "GitFailed",
    detail: error.detail,
    reason: "Failed",
  });
}

export function branchWriteFailed(error: RepositoryGitError, name: string) {
  if (!isGitRejection(error)) return branchGitFailed(error);
  const conflict = /'refs\/heads\/([^']+)' exists; cannot create/.exec(
    error.detail,
  )?.[1];
  if (conflict !== undefined)
    return branchesFailure({ _tag: "BranchExists", name: conflict }, error);
  if (/already exists/i.test(error.detail))
    return branchesFailure({ _tag: "BranchExists", name }, error);
  const holder = /used by worktree at '([^']+)'/.exec(error.detail)?.[1];
  if (holder !== undefined)
    return branchesFailure(
      { _tag: "BranchCheckedOutElsewhere", name, worktreePath: holder },
      error,
    );
  if (/not a valid branch name/i.test(error.detail))
    return branchesFailure({ _tag: "InvalidBranchName", name }, error);
  return branchGitFailed(error);
}

function fromRefsError(error: RepositoryRefsError) {
  const failure = error.failure;
  return branchesFailure(
    failure._tag === "CheckoutRejected"
      ? { _tag: "GitFailed", detail: failure.detail, reason: "Failed" }
      : failure,
    error.cause,
  );
}

export function branchesFailureStatus(error: RepositoryBranchesError) {
  switch (error.failure._tag) {
    case "RepositoryMissing":
    case "WorktreeMissing":
    case "RefMissing":
      return 404;
    case "BranchCheckedOutElsewhere":
    case "BranchExists":
    case "BranchMoved":
    case "BranchNotMerged":
      return 409;
    case "InvalidBranchName":
    case "GitFailed":
      return 422;
  }
}
