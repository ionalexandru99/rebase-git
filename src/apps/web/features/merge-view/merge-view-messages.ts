import type {
  ConflictFailure,
  RepositoryConflictsHttpApi,
} from "@rebase/contracts";
import type { EnvironmentRouteFailure } from "@rebase/environment-client";
import { describeUndeliveredCommand } from "#web/platform/query/command-failure-message";
import type { CommandFailure } from "#web/platform/query/use-command";

type ConflictsRoute =
  (typeof RepositoryConflictsHttpApi)[keyof typeof RepositoryConflictsHttpApi];

export type ConflictRequestFailure =
  | EnvironmentRouteFailure<ConflictsRoute>
  | CommandFailure<ConflictsRoute>;

export function conflictReason(
  error: ConflictRequestFailure | null,
): ConflictFailure["reason"] | null {
  return error?._tag === "EnvironmentHttpRejected" &&
    error.failure._tag === "ConflictFailed"
    ? error.failure.reason
    : null;
}

export function describeConflictFailure(error: ConflictRequestFailure) {
  return error._tag === "EnvironmentHttpRejected"
    ? error.failure.detail
    : describeUndeliveredCommand(error);
}

export function staleNotice(path: string) {
  return `${path.split("/").at(-1) ?? path} changed on disk. Reloaded.`;
}
