import type {
  PushBranch,
  PushDestination,
  RepositoryPushHttpApi,
  RouteFailure,
} from "@rebase/contracts";
import { destinationName } from "#web/features/repository-push/resolve-push-target";
import type { CommandFailure } from "#web/platform/query/use-command";

export function describePushProgress({ destination, mode }: PushBranch) {
  return `${mode._tag === "ForceWithLease" ? "Force pushing" : "Pushing"} to ${destinationName(destination)}`;
}

export function describePushFailure(
  error: CommandFailure<typeof RepositoryPushHttpApi.push>,
  destination: PushDestination,
) {
  const name = destinationName(destination);
  switch (error._tag) {
    case "Cancelled":
      return `Cancelled. ${name} reflects what reached the remote.`;
    case "EnvironmentResponseError":
      return `Connection lost. ${name} refreshes on reconnect.`;
    case "EnvironmentAccessDenied":
      return "No write access to this repository.";
    case "EnvironmentHttpRejected":
      return describePushRejection(error.failure, destination);
  }
}

function describePushRejection(
  failure: RouteFailure<typeof RepositoryPushHttpApi.push>,
  destination: PushDestination,
) {
  const name = destinationName(destination);
  switch (failure.reason) {
    case "NonFastForward":
      return `Rejected: ${name} has commits you don't have. Fetch first.`;
    case "LeaseRejected":
      return `Rejected: ${name} moved since your last fetch. Fetch and review.`;
    case "HookDeclined":
      return `Rejected by hook: ${failure.detail}`;
    case "Authentication":
      return `${destination.remote} rejected the credentials.`;
    case "Network":
      return `Can't reach ${destination.remote}.`;
    case "RemoteMissing":
      return `Remote ${destination.remote} not found.`;
    case "Busy":
      return "Another Git operation is running.";
    default:
      return failure.detail || "Push failed.";
  }
}
