import { RepositoryPullHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryPullClient,
  RepositoryPullDisconnected,
  RepositoryPullRejected,
} from "#web/features/repository-pull/repository-pull.contract";

export function repositoryPullClient(
  requests: EnvironmentRequestClient,
): RepositoryPullClient {
  return requests(RepositoryPullHttpApi, {
    disconnected: () => new RepositoryPullDisconnected(),
    response: (error) =>
      error._tag === "EnvironmentHttpRejected"
        ? new RepositoryPullRejected({ failure: error.failure })
        : new RepositoryPullDisconnected(),
  });
}
