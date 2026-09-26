import { RepositoryRefsHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryRefsClient,
  RepositoryRefsRejected,
  RepositoryRefsResponseError,
} from "#web/features/repository-refs/repository-refs-client.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function repositoryRefsClient(
  requests: EnvironmentRequestClient,
): RepositoryRefsClient {
  return effectRoutesClient(requests, RepositoryRefsHttpApi, (error) =>
    error._tag === "EnvironmentResponseError"
      ? new RepositoryRefsResponseError()
      : new RepositoryRefsRejected({ failure: error.failure }),
  );
}
