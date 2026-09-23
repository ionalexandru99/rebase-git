import { EnvironmentAuthorizationHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import { EnvironmentAuthorizationAccess } from "#server/domain/environment-authorization.contract";

export const environmentAuthorizationFeature = Effect.gen(function* () {
  const authorization = yield* EnvironmentAuthorizationAccess;
  const api = EnvironmentAuthorizationHttpApi;
  return {
    capabilities: [],
    httpRoutes: [
      httpRoute(
        api.createBrowserSession,
        (exchange, context) =>
          Effect.map(authorization.exchangePairing(exchange), (paired) => {
            context.establishBrowserSession(paired.credential);
            return { authorization: paired.authorization };
          }),
        { requiresOrigin: true },
      ),
      httpRoute(api.readBrowserSession, (_, context) =>
        Effect.succeed({ authorization: context.device }),
      ),
      httpRoute(api.createPairing, (pairing, context) =>
        Effect.map(authorization.createPairing(pairing), (created) => ({
          expiresAt: created.expiresAt,
          pairingUrl: `${context.origin}/pair#${created.material}`,
        })),
      ),
      httpRoute(api.exchangePairing, (exchange) =>
        authorization.exchangePairing(exchange),
      ),
      httpRoute(api.mintWebSocketTicket, (_, context) =>
        authorization.mintTicket(context.credential),
      ),
      httpRoute(api.revokeAuthorization, (revocation, context) =>
        authorization.revoke(context.credential, revocation.authorizationId),
      ),
    ],
  } satisfies EnvironmentFeature;
});
