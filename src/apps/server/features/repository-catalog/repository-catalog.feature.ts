import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import { repositoryCatalogHttpRoutes } from "#server/features/repository-catalog/http/repository-catalog-http-routes";

export function repositoryCatalogFeature(
  catalog: RepositoryCatalog,
): EnvironmentFeature {
  return {
    capabilities: [],
    httpRoutes: repositoryCatalogHttpRoutes(catalog),
  };
}
