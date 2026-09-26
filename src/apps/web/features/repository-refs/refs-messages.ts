import type {
  EnvironmentAccessFailure,
  RepositoryCheckoutFailure,
  RepositoryRefsHttpApi,
  RepositoryRejected,
} from "@rebase/contracts";
import type { RepositoryRefsReadFailure } from "#web/platform/environment/rpc/read-repository-refs";
import type { CommandFailure } from "#web/platform/query/use-command";

const unanswered = "The Environment did not answer.";

export function describeRefsReadFailure(error: RepositoryRefsReadFailure) {
  return error._tag === "EnvironmentResponseError"
    ? unanswered
    : describeRejection(error.failure);
}

export function describeCheckoutFailure(
  error: CommandFailure<typeof RepositoryRefsHttpApi.checkout>,
) {
  switch (error._tag) {
    case "Cancelled":
      return "The checkout was cancelled.";
    case "EnvironmentResponseError":
      return unanswered;
    case "EnvironmentAccessDenied":
    case "EnvironmentHttpRejected":
      return describeRejection(error.failure);
  }
}

function describeRejection(
  failure:
    | RepositoryCheckoutFailure
    | RepositoryRejected
    | EnvironmentAccessFailure,
) {
  switch (failure._tag) {
    case "BranchCheckedOutElsewhere":
      return `${failure.name} is checked out in ${failure.worktreePath}.`;
    case "RefMissing":
      return `${failure.name} no longer exists.`;
    case "CheckoutRejected":
      return failure.reason === "StashFailed"
        ? "Local changes could not be stashed."
        : "Local changes would be overwritten.";
    case "RepositoryRejected":
      return failure.detail.length === 0
        ? "Git could not complete the operation."
        : failure.detail;
    case "CapabilityDenied":
      return "This device may not write to the repository.";
    default:
      return "The request was rejected.";
  }
}
