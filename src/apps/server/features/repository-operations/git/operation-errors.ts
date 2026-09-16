import type { OperationFailure } from "@rebase/contracts/repository-operations/repository-operations.contract";
import { RepositoryOperationError } from "#server/domain/repository-operations.contract";

export const noInvalidation = {
  status: false,
  refs: false,
  history: false,
} as const;
export const recoveryInvalidation = {
  status: true,
  refs: true,
  history: true,
} as const;

export function operationError(
  reason: OperationFailure["reason"],
  detail: string,
  invalidation: OperationFailure["invalidation"] = noInvalidation,
) {
  return new RepositoryOperationError({
    failure: {
      _tag: "OperationFailed",
      reason,
      detail: detail.slice(0, 2048),
      invalidation,
    },
  });
}
