import { type RepositoryRejected, repositoryRejected } from "@rebase/contracts";
import type { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { GitCommandError } from "#server/domain/git-command.contract";
import {
  accessRejection,
  RepositoryAccessError,
} from "#server/domain/repository-access.contract";
import { RepositoryCoordinationError } from "#server/domain/repository-coordination.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";

export type RepositoryInfrastructureError =
  | RepositoryAccessError
  | RepositoryCoordinationError
  | GitCommandError
  | RepositoryGitError;

export function rejectAccess(
  error: RepositoryAccessError,
): RepositoryRejected | EnvironmentStorageError {
  return error.failure._tag === "CatalogUnavailable"
    ? error.failure.cause
    : accessRejection(error);
}

export function rejectInfrastructure<Failure>(
  error: Failure | RepositoryInfrastructureError,
): Failure | RepositoryRejected | EnvironmentStorageError {
  if (error instanceof RepositoryAccessError) return rejectAccess(error);
  if (error instanceof RepositoryCoordinationError)
    return coordinationRejection(error);
  if (error instanceof GitCommandError || error instanceof RepositoryGitError)
    return gitFailed(error);
  return error;
}

export function rejectCoordination<Failure>(
  error: Failure | RepositoryCoordinationError,
): Failure | RepositoryRejected {
  return error instanceof RepositoryCoordinationError
    ? coordinationRejection(error)
    : error;
}

function coordinationRejection(error: RepositoryCoordinationError) {
  return error.reason === "Unavailable"
    ? repositoryRejected("GitFailed", error.detail)
    : repositoryRejected(error.reason, error.detail);
}

function gitFailed(error: GitCommandError | RepositoryGitError) {
  return repositoryRejected(
    "GitFailed",
    error instanceof GitCommandError
      ? error.stderr?.trim() ||
          `Git could not complete the operation (${error.reason}).`
      : error.detail,
  );
}
