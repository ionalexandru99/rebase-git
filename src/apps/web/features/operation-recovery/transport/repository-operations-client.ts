import { RepositoryOperationsHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  OperationRecoveryError,
  type RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";

export function repositoryOperationsClient(
  requests: EnvironmentRequestClient,
): RepositoryOperationsClient {
  return requests(RepositoryOperationsHttpApi, {
    disconnected: () =>
      new OperationRecoveryError({
        message:
          "Could not confirm Git state. Check the environment connection.",
      }),
    response: (error) =>
      new OperationRecoveryError({
        message:
          error._tag !== "EnvironmentHttpRejected"
            ? "Could not confirm Git state. Check the environment connection."
            : error.failure._tag === "OperationFailed"
              ? error.failure.detail
              : "The environment rejected the request. Check your access and reconnect.",
      }),
  });
}
