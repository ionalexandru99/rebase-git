import {
  OperationsHttpFailure,
  RepositoryOperationsHttpApi,
} from "@rebase/contracts/repository-operations/repository-operations.contract";
import { Effect, type Schema } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";
import {
  OperationRecoveryError,
  type RepositoryOperationsClient,
} from "#web/features/operation-recovery/operation-recovery.contract";

export function createRepositoryOperationsClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): RepositoryOperationsClient {
  const request = <S extends Schema.ConstraintDecoder<unknown, never>>(
    path: string,
    success: S,
    command: unknown,
  ) =>
    Effect.suspend(() => {
      const authorized = credential();
      if (!authorized) return Effect.fail(unavailable());
      return requestEnvironmentJson(
        new URL(path, origin),
        "POST",
        authorized,
        success,
        OperationsHttpFailure,
        JSON.stringify(command),
      ).pipe(
        Effect.mapError((error) => {
          if (error._tag !== "EnvironmentHttpRejected") return unavailable();
          if (error.failure._tag === "OperationFailed")
            return new OperationRecoveryError({ failure: error.failure });
          return new OperationRecoveryError({
            failure: {
              _tag: "OperationFailed",
              reason:
                error.status === 401 || error.status === 403
                  ? "Unauthorized"
                  : "Incompatible",
              detail:
                "The environment rejected the request. Check your access and reconnect.",
              invalidation: { status: false, refs: false, history: false },
            },
          });
        }),
      );
    });
  const api = RepositoryOperationsHttpApi;
  return {
    read: (command) => request(api.read.path, api.read.success, command),
    execute: (command) =>
      request(api.execute.path, api.execute.success, command),
  };
}

function unavailable() {
  return new OperationRecoveryError({
    failure: {
      _tag: "OperationFailed",
      reason: "Uncertain",
      detail: "Could not confirm Git state. Check the environment connection.",
      invalidation: { status: true, refs: true, history: true },
    },
  });
}
