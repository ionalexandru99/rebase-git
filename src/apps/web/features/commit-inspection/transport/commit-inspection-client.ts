import { CommitInspectionHttpApi } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { ChangesHttpFailure } from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect, type Schema } from "effect";
import {
  type CommitInspectionClient,
  CommitInspectionError,
} from "#web/features/commit-inspection/commit-inspection.contract";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";

export function createCommitInspectionClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): CommitInspectionClient {
  const request = <S extends Schema.ConstraintDecoder<unknown, never>>(
    path: string,
    success: S,
    command: unknown,
  ) =>
    Effect.suspend(() => {
      const authorized = credential();
      if (authorized === undefined)
        return Effect.fail(
          new CommitInspectionError({
            message: "Connect to the environment to inspect commits.",
          }),
        );
      return requestEnvironmentJson(
        new URL(path, origin),
        "POST",
        authorized,
        success,
        ChangesHttpFailure,
        JSON.stringify(command),
      ).pipe(
        Effect.mapError(
          (error) =>
            new CommitInspectionError({
              message:
                error._tag === "EnvironmentHttpRejected" &&
                error.failure._tag === "ChangesFailed"
                  ? error.failure.detail
                  : "Could not load this commit. Check the environment connection and try again.",
            }),
        ),
      );
    });
  const api = CommitInspectionHttpApi;
  return {
    inspect: (command) =>
      request(api.inspect.path, api.inspect.success, command),
    diff: (command) =>
      request(api.inspectDiff.path, api.inspectDiff.success, command),
  };
}
