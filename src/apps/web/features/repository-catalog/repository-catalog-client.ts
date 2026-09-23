import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryCatalogClient,
  RepositoryCatalogRejected,
  RepositoryCatalogResponseError,
} from "#web/features/repository-catalog/repository-catalog-client.contract";

export function repositoryCatalogClient(
  requests: EnvironmentRequestClient,
): RepositoryCatalogClient {
  return requests(RepositoryCatalogHttpApi, {
    disconnected: () => new RepositoryCatalogResponseError(),
    response: (error) =>
      error._tag === "EnvironmentHttpRejected"
        ? new RepositoryCatalogRejected({
            failure: error.failure,
            status: error.status,
          })
        : new RepositoryCatalogResponseError(),
  });
}
