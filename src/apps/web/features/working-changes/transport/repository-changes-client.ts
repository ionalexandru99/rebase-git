import { RepositoryChangesHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryChangesClient,
  WorkingChangesError,
} from "#web/features/working-changes/working-changes.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function repositoryChangesClient(
  requests: EnvironmentRequestClient,
): RepositoryChangesClient {
  return effectRoutesClient(
    requests,
    RepositoryChangesHttpApi,
    (error) =>
      new WorkingChangesError({
        message:
          error._tag === "EnvironmentHttpRejected"
            ? error.failure.detail
            : "Could not complete the request. Check the environment connection and try again.",
      }),
  );
}
