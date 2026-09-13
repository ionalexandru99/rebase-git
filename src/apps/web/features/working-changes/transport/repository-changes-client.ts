import {
  ChangesHttpFailure,
  RepositoryChangesHttpApi,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import { Effect, type Schema } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { requestEnvironmentJson } from "#web/features/environment-connection/http/environment-http-json";
import {
  type RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";

export function createRepositoryChangesClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): RepositoryChangesClient {
  const request = <S extends Schema.ConstraintDecoder<unknown, never>>(
    path: string,
    success: S,
    command: unknown,
  ) =>
    Effect.suspend(() => {
      const authorized = credential();
      if (authorized === undefined)
        return Effect.fail(
          new WorkingChangesError({
            message: "Connect to the environment to review changes.",
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
            new WorkingChangesError({
              message:
                error._tag === "EnvironmentHttpRejected" &&
                error.failure._tag === "ChangesFailed"
                  ? error.failure.detail
                  : "Could not complete the request. Check the environment connection and try again.",
            }),
        ),
      );
    });
  const api = RepositoryChangesHttpApi;
  return {
    read: (command) => request(api.read.path, api.read.success, command),
    diff: (command) => request(api.diff.path, api.diff.success, command),
    mutate: (command) => request(api.mutate.path, api.mutate.success, command),
    commit: (command) => request(api.commit.path, api.commit.success, command),
  };
}
