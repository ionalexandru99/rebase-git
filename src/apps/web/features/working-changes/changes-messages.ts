import type {
  ConflictFailure,
  RepositoryChangesHttpApi,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import type { EnvironmentRouteFailure } from "@rebase/environment-client";
import type { CommandFailure } from "#web/platform/query/use-command";

type ChangesRoute =
  | typeof RepositoryChangesHttpApi.read
  | typeof RepositoryChangesHttpApi.diff
  | typeof RepositoryChangesHttpApi.mutate
  | typeof RepositoryChangesHttpApi.commit
  | typeof RepositoryConflictsHttpApi.list
  | typeof RepositoryConflictsHttpApi.document
  | typeof RepositoryConflictsHttpApi.stage
  | typeof RepositoryConflictsHttpApi.choose
  | typeof RepositoryConflictsHttpApi.write;

export const headMovedMessage =
  "HEAD changed while you were amending. Review the latest commit before enabling Amend again.";

export const storageUnavailableMessage =
  "Could not access changes preferences or the commit draft in this browser.";

export type ChangesRequestFailure =
  | EnvironmentRouteFailure<ChangesRoute>
  | CommandFailure<ChangesRoute>;

export function describeChangesFailure(error: ChangesRequestFailure) {
  switch (error._tag) {
    case "EnvironmentHttpRejected":
      return error.failure.detail;
    case "EnvironmentAccessDenied":
      return "This device may not change the repository.";
    case "Cancelled":
      return "The request was cancelled.";
    case "EnvironmentResponseError":
      return "Could not complete the request. Check the environment connection and try again.";
  }
}

export function conflictReason(
  error: ChangesRequestFailure | null,
): ConflictFailure["reason"] | null {
  return error?._tag === "EnvironmentHttpRejected" &&
    error.failure._tag === "ConflictFailed"
    ? error.failure.reason
    : null;
}

export function wholeFileOnly(error: ChangesRequestFailure | null) {
  const reason = conflictReason(error);
  return reason === "Unsupported" || reason === "TooLarge";
}
