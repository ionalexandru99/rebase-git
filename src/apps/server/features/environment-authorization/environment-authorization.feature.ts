import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentAuthorization } from "#server/domain/environment-authorization.contract";
import { environmentAuthorizationHttpRoutes } from "#server/features/environment-authorization/http/environment-authorization-http-routes";

export function environmentAuthorizationFeature(
  authorization: EnvironmentAuthorization,
): EnvironmentFeature {
  return {
    capabilities: [],
    httpRoutes: environmentAuthorizationHttpRoutes(authorization),
  };
}
