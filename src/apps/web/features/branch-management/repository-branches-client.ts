import { RepositoryBranchesHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryBranchesClient,
  RepositoryBranchesRejected,
  RepositoryBranchesResponseError,
} from "#web/features/branch-management/branch-management.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function repositoryBranchesClient(
  requests: EnvironmentRequestClient,
): RepositoryBranchesClient {
  return effectRoutesClient(requests, RepositoryBranchesHttpApi, (error) =>
    error._tag === "EnvironmentResponseError"
      ? new RepositoryBranchesResponseError()
      : new RepositoryBranchesRejected({ failure: error.failure }),
  );
}
