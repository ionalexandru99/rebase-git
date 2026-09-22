import {
  ChangesHttpFailure,
  RepositoryChangesHttpApi,
} from "@rebase/contracts/repository-changes/repository-changes.contract";
import type {
  EnvironmentCredential,
  EnvironmentRequestClient,
} from "@rebase/environment-client";
import { createEnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";

export function createRepositoryChangesClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): RepositoryChangesClient {
  return repositoryChangesClient(
    createEnvironmentRequestClient(origin, credential),
  );
}

export function repositoryChangesClient(
  requests: EnvironmentRequestClient,
): RepositoryChangesClient {
  const request = requests(ChangesHttpFailure, {
    disconnected: () =>
      new WorkingChangesError({
        message: "Connect to the environment to review changes.",
      }),
    response: (error) =>
      new WorkingChangesError({
        message:
          error._tag === "EnvironmentHttpRejected" &&
          error.failure._tag === "ChangesFailed"
            ? error.failure.detail
            : "Could not complete the request. Check the environment connection and try again.",
      }),
  });
  const api = RepositoryChangesHttpApi;
  return {
    read: (command) => request(api.read, command),
    diff: (command) => request(api.diff, command),
    mutate: (command) => request(api.mutate, command),
    commit: (command) => request(api.commit, command),
  };
}
