import type { BranchesSidebarScope } from "#web/features/branches-sidebar/branches-sidebar.contract";
import type { RepositoryRefsControllerError } from "#web/features/repository-refs/repository-refs-controller.contract";

export function describeEmptyBranchesSidebar(
  scope: BranchesSidebarScope,
  query: string,
): string {
  const matching = query.trim().length > 0;
  switch (scope) {
    case "local":
      return matching ? "No local branches match." : "No local branches.";
    case "remote":
      return matching ? "No remote branches match." : "No remote branches.";
    case "tags":
      return matching ? "No tags match." : "No tags.";
    default:
      return matching ? "No branches match." : "No branches or tags.";
  }
}

export function describeRepositoryRefsError(
  error: RepositoryRefsControllerError,
): string {
  if (error._tag === "RepositoryRefsUnavailable") {
    return "The Environment is not connected.";
  }
  if (error._tag === "RepositoryRefsBusy") {
    return "A checkout is still running.";
  }
  if (error._tag === "RepositoryRefsResponseError") {
    return "The Environment did not answer.";
  }
  const failure = error.failure;
  switch (failure._tag) {
    case "BranchCheckedOutElsewhere":
      return `${failure.name} is checked out in ${failure.worktreePath}.`;
    case "RefMissing":
      return `${failure.name} no longer exists.`;
    case "CheckoutRejected":
      return failure.reason === "StashFailed"
        ? "Local changes could not be stashed."
        : "Local changes would be overwritten.";
    case "GitFailed":
      return failure.detail === undefined || failure.detail.length === 0
        ? "Git could not complete the operation."
        : failure.detail;
    case "WorktreeMissing":
      return "The active worktree is gone.";
    case "RepositoryMissing":
      return "The repository is no longer known.";
    case "CapabilityDenied":
      return "This device may not write to the repository.";
    default:
      return "The request was rejected.";
  }
}
