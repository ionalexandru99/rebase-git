import { EnvironmentAuthorizationHttpApi } from "@rebase/contracts";
import { Effect } from "effect";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type { EnvironmentAuthorization } from "#server/domain/environment-authorization.contract";

export function environmentAuthorizationHttpRoutes(
  authorization: EnvironmentAuthorization,
): readonly EnvironmentHttpRouteHandler[] {
  const api = EnvironmentAuthorizationHttpApi;
  return [
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
  ];
}
