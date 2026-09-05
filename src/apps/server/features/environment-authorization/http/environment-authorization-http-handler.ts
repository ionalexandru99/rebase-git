import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CreateEnvironmentPairing,
  EnvironmentAuthorizationHttpApi,
  EnvironmentAuthorizationRevoked,
  EnvironmentPairingCreated,
  EnvironmentPairingExchanged,
  EnvironmentWebSocketTicket,
  ExchangeEnvironmentPairing,
  RevokeEnvironmentAuthorization,
} from "@rebase/contracts";
import { Effect } from "effect";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { respondToBrowserSessionRequest } from "#server/features/environment-authorization/http/environment-browser-session-handler";
import {
  expectedRequestOrigin,
  readRequestCredential,
  validateRequestOrigin,
} from "#server/features/environment-connection/environment-request-authorization";
import {
  decodeRequestBody,
  requireEmptyBody,
  requireMethod,
} from "#server/features/environment-connection/http/environment-http-request-validation";
import { writeJson } from "#server/features/environment-connection/http/environment-http-response";

export function respondToEnvironmentAuthorizationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
) {
  return Effect.gen(function* () {
    if (
      request.url === EnvironmentAuthorizationHttpApi.readBrowserSession.path
    ) {
      yield* respondToBrowserSessionRequest(
        request,
        response,
        body,
        authorization,
      );
      return true;
    }
    if (request.url === EnvironmentAuthorizationHttpApi.exchangePairing.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentAuthorizationHttpApi.exchangePairing.method,
      );
      yield* validateRequestOrigin(request, false);
      const result = yield* authorization.exchangePairing(
        yield* decodeRequestBody(ExchangeEnvironmentPairing, body),
      );
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.exchangePairing.successStatus,
        EnvironmentPairingExchanged,
        result,
      );
      return true;
    }

    if (request.url === EnvironmentAuthorizationHttpApi.createPairing.path) {
      yield* requireMethod(
        request,
        response,
        EnvironmentAuthorizationHttpApi.createPairing.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* authorization.authorize(
        readRequestCredential(request),
        "authorization.manage",
      );
      const pairing = yield* authorization.createPairing(
        yield* decodeRequestBody(CreateEnvironmentPairing, body),
      );
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.createPairing.successStatus,
        EnvironmentPairingCreated,
        {
          expiresAt: pairing.expiresAt,
          pairingUrl: `${expectedRequestOrigin(request)}/pair#${pairing.material}`,
        },
      );
      return true;
    }

    if (
      request.url === EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path
    ) {
      yield* requireMethod(
        request,
        response,
        EnvironmentAuthorizationHttpApi.mintWebSocketTicket.method,
      );
      yield* validateRequestOrigin(request, false);
      yield* requireEmptyBody(body);
      const ticket = yield* authorization.mintTicket(
        readRequestCredential(request),
      );
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.mintWebSocketTicket.successStatus,
        EnvironmentWebSocketTicket,
        ticket,
      );
      return true;
    }

    if (
      request.url === EnvironmentAuthorizationHttpApi.revokeAuthorization.path
    ) {
      yield* requireMethod(
        request,
        response,
        EnvironmentAuthorizationHttpApi.revokeAuthorization.method,
      );
      yield* validateRequestOrigin(request, false);
      const revocation = yield* decodeRequestBody(
        RevokeEnvironmentAuthorization,
        body,
      );
      const revoked = yield* authorization.revoke(
        readRequestCredential(request),
        revocation.authorizationId,
      );
      writeJson(
        response,
        EnvironmentAuthorizationHttpApi.revokeAuthorization.successStatus,
        EnvironmentAuthorizationRevoked,
        revoked,
      );
      return true;
    }

    return false;
  });
}
