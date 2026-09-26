import { RepositoryBranchesHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryBranchesClient,
  RepositoryBranchesRejected,
  RepositoryBranchesResponseError,
} from "#web/features/branch-management/branch-management.contract";

export function repositoryBranchesClient(
  requests: EnvironmentRequestClient,
): RepositoryBranchesClient {
  return requests(RepositoryBranchesHttpApi, {
    disconnected: () => new RepositoryBranchesResponseError(),
    response: (error) =>
      error._tag === "EnvironmentResponseError"
        ? new RepositoryBranchesResponseError()
        : new RepositoryBranchesRejected({ failure: error.failure }),
  });
}
