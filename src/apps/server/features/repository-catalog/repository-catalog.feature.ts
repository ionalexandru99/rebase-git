import { RepositoryCatalogApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes";
import { route } from "#server/adapters/environment-transport/environment-routes";
import type { RepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";

export function repositoryCatalogFeature(
  catalog: RepositoryCatalog,
): EnvironmentFeature {
  const api = RepositoryCatalogApi;
  return {
    routes: [
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
