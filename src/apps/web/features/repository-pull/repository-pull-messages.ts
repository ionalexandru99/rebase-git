import type { RepositoryPullHttpApi, RouteFailure } from "@rebase/contracts";
import type { CommandFailure } from "#web/platform/query/use-command";

export function describePullFailure(
  branch: string,
  error: CommandFailure<typeof RepositoryPullHttpApi.pull>,
) {
  switch (error._tag) {
    case "EnvironmentResponseError":
      return "You're offline";
    case "EnvironmentAccessDenied":
      return error.failure._tag === "CapabilityDenied"
        ? "No write access"
        : "Pull failed";
    case "EnvironmentHttpRejected":
      return describePullRejection(branch, error.failure);
    case "Cancelled":
      return "Pull failed";
  }
}

function describePullRejection(
  branch: string,
  failure: RouteFailure<typeof RepositoryPullHttpApi.pull>,
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
  }
}
