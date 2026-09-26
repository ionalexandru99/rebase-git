import { RepositoryRefsHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryRefsClient,
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";

export function repositoryRefsClient(
  requests: EnvironmentRequestClient,
): RepositoryRefsClient {
  return requests(RepositoryRefsHttpApi, {
    disconnected: () => new RepositoryRefsResponseError(),
    response: (error) =>
      error._tag === "EnvironmentResponseError"
        ? new RepositoryRefsResponseError()
        : new RepositoryRefsRejected({ failure: error.failure }),
  });
}
