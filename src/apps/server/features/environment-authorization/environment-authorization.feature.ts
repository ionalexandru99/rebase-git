import { EnvironmentAuthorizationApi } from "@rebase/contracts";
import { Effect } from "effect";
import {
  type EnvironmentFeature,
  route,
} from "#server/adapters/environment-transport/environment-routes";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";

export function environmentAuthorizationFeature(
  authorization: EnvironmentAuthorization,
): EnvironmentFeature {
  const api = EnvironmentAuthorizationApi;
  return {
    routes: [
      route(api.createPairing, (_, context) =>
        Effect.map(authorization.createPairing(), (created) => ({
          expiresAt: created.expiresAt,
          pairingUrl: `${context.origin}/pair#${created.material}`,
        })),
      ),
      route(api.revokeAuthorization, (revocation) =>
        authorization.revoke(revocation.authorizationId),
      ),
    ],
  };
}
