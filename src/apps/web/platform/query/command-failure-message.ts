import type {
  EnvironmentAccessDenied,
  EnvironmentResponseError,
} from "@rebase/environment-client";
import type { CommandCancelled } from "#web/platform/query/use-command";

export function describeUndeliveredCommand(
  error: CommandCancelled | EnvironmentResponseError | EnvironmentAccessDenied,
): string {
  switch (error._tag) {
    case "Cancelled":
      return "The request was cancelled.";
    case "EnvironmentResponseError":
      return "The Environment did not answer.";
    case "EnvironmentAccessDenied":
      return "This device may not write to the repository.";
  }
}
