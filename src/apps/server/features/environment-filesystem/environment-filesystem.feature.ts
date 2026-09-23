import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentFilesystem } from "#server/domain/environment-filesystem.contract";
import { environmentFilesystemHttpRoutes } from "#server/features/environment-filesystem/http/environment-filesystem-http-routes";

export function environmentFilesystemFeature(
  filesystem: EnvironmentFilesystem,
): EnvironmentFeature {
  return {
    capabilities: [],
    httpRoutes: environmentFilesystemHttpRoutes(filesystem),
  };
}
