import {
  RepositoryPullDisconnected,
  RepositoryPullRejected,
} from "#web/features/repository-pull/repository-pull.contract";

export function describeRepositoryPullError(branch: string, error: unknown) {
  if (error instanceof RepositoryPullRejected)
    return describePullFailure(branch, error.failure);
  if (error instanceof RepositoryPullDisconnected) return "You're offline";
  return "Pull failed";
}

function describePullFailure(
  branch: string,
  failure: RepositoryPullRejected["failure"],
) {
  switch (failure._tag) {
    case "PullDiverged":
      return `${branch} has diverged from ${failure.upstream}`;
    case "PullWouldOverwrite":
      return failure.paths.length === 1
        ? `Local changes to ${failure.paths[0]} block the pull`
        : "Local changes block the pull";
    case "UpstreamMissing":
      return failure.upstream === undefined
        ? `${branch} has no upstream`
        : `${failure.upstream} was deleted`;
    case "PullBlocked":
      return failure.detail;
    case "PullUncertain":
      return "Pull may not have finished";
    case "BranchMissing":
      return `${branch} no longer exists`;
    case "RepositoryRejected":
      return failure.reason === "Missing"
        ? "Repository unavailable"
        : failure.detail;
    case "CapabilityDenied":
      return "No write access";
    default:
      return "Pull failed";
  }
}
