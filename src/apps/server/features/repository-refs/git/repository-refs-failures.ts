import type { RepositoryRefsOperationFailure } from "@rebase/contracts";
import { Data } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { RepositoryAccessError } from "#server/domain/repository-access.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { isGitRejection } from "#server/repository/access/index";

export class RepositoryRefsError extends Data.TaggedError(
  "RepositoryRefsError",
)<{
  readonly cause?: unknown;
  readonly failure: RepositoryRefsOperationFailure;
}> {}

export function repositoryRefsFailure(
  failure: RepositoryRefsOperationFailure,
  cause?: unknown,
) {
  return new RepositoryRefsError({
    ...(cause === undefined ? {} : { cause }),
    failure,
  });
}

export function gitFailed(error: RepositoryGitError) {
  return repositoryRefsFailure(
    isGitRejection(error)
      ? {
          _tag: "GitFailed",
          detail: error.detail,
          reason: /not a git repository/i.test(error.detail)
            ? "NotRepository"
            : "Failed",
        }
      : { _tag: "GitFailed", reason: error.reason },
    error,
  );
}

export function repositoryAccessFailed(
  error: RepositoryAccessError | EnvironmentStorageError,
) {
  if (error._tag === "EnvironmentStorageError") return error;
  switch (error.failure._tag) {
    case "CatalogUnavailable":
      return error.failure.cause;
    case "RepositoryMissing":
      return repositoryRefsFailure({
        _tag: "RepositoryMissing",
        repositoryId: error.failure.repositoryId,
      });
    case "WorktreesUnreadable":
      return gitFailed(error.failure.cause);
    case "WorktreeMissing":
      return repositoryRefsFailure({
        _tag: "WorktreeMissing",
        worktreePath: error.failure.worktreePath,
      });
  }
}

export function checkoutFailure(
  error: RepositoryGitError,
  targetName: string,
): RepositoryRefsError {
  if (!isGitRejection(error)) return gitFailed(error);
  const elsewhere =
    /already (?:checked out|used by worktree) at '([^']+)'/.exec(error.detail);
  if (elsewhere?.[1] !== undefined) {
    return repositoryRefsFailure({
      _tag: "BranchCheckedOutElsewhere",
      name: targetName,
      worktreePath: elsewhere[1],
    });
  }
  if (
    /did not match any file\(s\) known to git|invalid reference|is not a commit and a branch/i.test(
      error.detail,
    )
  ) {
    return repositoryRefsFailure({ _tag: "RefMissing", name: targetName });
  }
  if (/would be overwritten by checkout/i.test(error.detail)) {
    return repositoryRefsFailure({
      _tag: "CheckoutRejected",
      detail: error.detail,
      reason: "LocalChanges",
    });
  }
  return repositoryRefsFailure({
    _tag: "GitFailed",
    detail: error.detail,
    reason: "Failed",
  });
}
