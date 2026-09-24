import type { OperationFailure } from "@rebase/contracts";
import { Data } from "effect";
import type { RepositoryCoordinationError } from "#server/domain/repository-coordination.contract";

export class RepositoryOperationError extends Data.TaggedError(
  "RepositoryOperationError",
)<{
  readonly failure: OperationFailure;
}> {}

export function operationError(
  reason: OperationFailure["reason"],
  detail: string,
) {
  return new RepositoryOperationError({
    failure: { _tag: "OperationFailed", reason, detail: detail.slice(0, 2048) },
  });
}

export function coordinationFailed(error: RepositoryCoordinationError) {
  return operationError(
    error.reason === "Busy"
      ? "Locked"
      : error.reason === "Incompatible"
        ? "Incompatible"
        : "InspectionFailed",
    error.detail,
  );
}
