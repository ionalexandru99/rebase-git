import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryCatalogClient,
  RepositoryCatalogRejected,
  RepositoryCatalogResponseError,
} from "#web/features/repository-catalog/repository-catalog-client.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function repositoryCatalogClient(
  requests: EnvironmentRequestClient,
): RepositoryCatalogClient {
  return effectRoutesClient(requests, RepositoryCatalogHttpApi, (error) =>
    error._tag === "EnvironmentResponseError"
      ? new RepositoryCatalogResponseError()
      : new RepositoryCatalogRejected({ failure: error.failure }),
  );
}
