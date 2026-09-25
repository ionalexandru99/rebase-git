import {
  RepositoryBranchesRejected,
  RepositoryBranchesResponseError,
} from "#web/features/branch-management/index";

export function describeBranchError(error: unknown): string {
  if (error instanceof RepositoryBranchesResponseError)
    return "The Environment did not answer.";
  if (!(error instanceof RepositoryBranchesRejected))
    return "The Environment is not connected.";
  const failure = error.failure;
  switch (failure._tag) {
    case "InvalidBranchName":
      return `${failure.name} is not a valid branch name.`;
    case "BranchExists":
      return `${failure.name} already exists.`;
    case "BranchMoved":
      return `${failure.name} changed since it was shown. Try again.`;
    case "BranchNotMerged":
      return `${failure.count} commits exist only on ${failure.name}.`;
    case "BranchCheckedOutElsewhere":
      return `${failure.name} is checked out in ${failure.worktreePath}.`;
    case "RefMissing":
      return `${failure.name} no longer exists.`;
    case "WorktreeMissing":
      return "The active worktree is gone.";
    case "RepositoryMissing":
      return "The repository is no longer known.";
    case "GitFailed":
      return failure.detail === undefined || failure.detail.length === 0
        ? "Git could not complete the operation."
        : failure.detail;
    default:
      return "This device may not write to the repository.";
  }
}
