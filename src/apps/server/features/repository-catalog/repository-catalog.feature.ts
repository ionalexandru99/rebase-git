import { RepositoryCatalogHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { route } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";

export const repositoryCatalogFeature = Effect.gen(function* () {
  const catalog = yield* RepositoryCatalogAccess;
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
  } satisfies EnvironmentFeature;
});
