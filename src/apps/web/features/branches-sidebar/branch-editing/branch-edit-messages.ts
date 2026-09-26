import type { BranchCommandFailure } from "#web/features/branch-management/hooks/use-branch-commands";

export function describeBranchError(error: BranchCommandFailure): string {
  switch (error._tag) {
    case "Cancelled":
      return "The request was cancelled.";
    case "EnvironmentResponseError":
      return "The Environment did not answer.";
    case "EnvironmentAccessDenied":
      return "This device may not write to the repository.";
  }
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
    case "RepositoryRejected":
      return failure.detail.length === 0
        ? "Git could not complete the operation."
        : failure.detail;
  }
}
