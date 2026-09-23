import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { RepositoryChangesService } from "#server/domain/repository-changes.contract";
import { repositoryChangesHttpRoutes } from "#server/features/repository-changes/http/repository-changes-http-routes";

export function repositoryChangesFeature(
  changes: RepositoryChangesService,
): EnvironmentFeature {
  return {
    capabilities: [],
    httpRoutes: repositoryChangesHttpRoutes(changes),
  };
}
