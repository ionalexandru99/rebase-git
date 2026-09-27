import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/combine-environment-features";
import { route } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { RepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";

export function repositoryCatalogFeature(
  catalog: RepositoryCatalog,
): EnvironmentFeature {
  const api = RepositoryCatalogHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      route(api.list, () =>
        Effect.map(catalog.list(), (repositories) => ({ repositories })),
      ),
      route(api.remember, (input) => catalog.remember(input.path)),
      route(api.recordOpened, (input) =>
        catalog.recordOpened(input.repositoryId),
      ),
      route(api.remove, (input) => catalog.remove(input.repositoryId)),
    ],
  };
}
