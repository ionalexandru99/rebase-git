import type { EnvironmentRequestFailure } from "@rebase/environment-client";
import type { CommandCancelled } from "#web/platform/query/use-command";

export function describeOperationFailure(
  error:
    | EnvironmentRequestFailure<{ readonly detail: string }>
    | CommandCancelled,
) {
  switch (error._tag) {
    case "EnvironmentHttpRejected":
      return error.failure.detail;
    case "EnvironmentAccessDenied":
      return "The environment rejected the request. Check your access and reconnect.";
    default:
      return "Could not confirm Git state. Check the environment connection.";
  }
}
