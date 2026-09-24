import type { PullFailure } from "@rebase/contracts";
import { Data } from "effect";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import type { RepositoryAccessError } from "#server/domain/repository-access.contract";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { isGitRejection } from "#server/repository/access/index";

export class RepositoryPullError extends Data.TaggedError(
  "RepositoryPullError",
)<{
  readonly cause?: unknown;
  readonly failure: PullFailure;
}> {}

export function pullFailure(failure: PullFailure, cause?: unknown) {
  return new RepositoryPullError({
    ...(cause === undefined ? {} : { cause }),
    failure,
  });
}

export function pullBlocked(detail: string) {
  return pullFailure({ _tag: "PullBlocked", detail: detail.slice(0, 2_048) });
}

export function pullGitFailed(error: RepositoryGitError) {
  return pullFailure(
    isGitRejection(error)
      ? { _tag: "GitFailed", detail: error.detail, reason: "Failed" }
      : { _tag: "GitFailed", reason: error.reason },
    error,
  );
}

export function pullAccessFailed(
  error: RepositoryAccessError | EnvironmentStorageError,
) {
  if (error._tag === "EnvironmentStorageError") return error;
  switch (error.failure._tag) {
    case "CatalogUnavailable":
      return error.failure.cause;
    case "RepositoryMissing":
      return pullFailure({
        _tag: "RepositoryMissing",
        repositoryId: error.failure.repositoryId,
      });
    case "WorktreesUnreadable":
      return pullGitFailed(error.failure.cause);
    case "WorktreeMissing":
      return pullBlocked(error.detail);
  }
}
