import { type RepositoryRejected, repositoryRejected } from "@rebase/contracts";
import { GitCommandError } from "#server/domain/git-command.contract";
import { RepositoryAccessError } from "#server/domain/repository-access.contract";
import { RepositoryCoordinationError } from "#server/domain/repository-coordination.contract";
import { RepositoryGitError } from "#server/domain/repository-git.contract";

export type RepositoryInfrastructureError =
  | RepositoryAccessError
  | RepositoryCoordinationError
  | GitCommandError
  | RepositoryGitError;

export function worktreeRejection(error: RepositoryAccessError) {
  return repositoryRejected("Missing", error.detail);
}

export function rejectInfrastructure<Failure>(
  error: Failure | RepositoryInfrastructureError,
): Failure | RepositoryRejected {
  return isInfrastructureError(error) ? gitFailed(error) : error;
}

export function rejectCoordination<Failure>(
  error: Failure | RepositoryCoordinationError,
): Failure | RepositoryRejected {
  if (!(error instanceof RepositoryCoordinationError)) return error;
  return error.reason === "Unavailable"
    ? repositoryRejected("GitFailed", error.detail)
    : repositoryRejected(error.reason, error.detail);
}

function isInfrastructureError(
  error: unknown,
): error is RepositoryInfrastructureError {
  return (
    error instanceof RepositoryAccessError ||
    error instanceof RepositoryCoordinationError ||
    error instanceof GitCommandError ||
    error instanceof RepositoryGitError
  );
}

function gitFailed(error: RepositoryInfrastructureError) {
  return repositoryRejected(
    "GitFailed",
    error instanceof GitCommandError
      ? error.stderr?.trim() ||
          `Git could not complete the operation (${error.reason}).`
      : error.detail,
  );
}
