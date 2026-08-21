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
import type { EnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import {
  expectedRequestOrigin,
  readBearerCredential,
  validateRequestOrigin,
} from "@rebase/server/features/environment-connection/environment-request-authorization";
import { EnvironmentHttpBodyError } from "@rebase/server/features/environment-connection/http/environment-http-request-body";
import { writeJson } from "@rebase/server/features/environment-connection/http/environment-http-response";
import { Effect, Schema } from "effect";

export function respondToEnvironmentAuthorizationRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: Buffer,
  authorization: EnvironmentAuthorization,
) {
  return Effect.gen(function* () {
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
        readBearerCredential(request),
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
        readBearerCredential(request),
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
        readBearerCredential(request),
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

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
) {
  if (request.method === method) return Effect.void;
  return Effect.sync(() =>
    response.writeHead(405, { allow: method }).end(),
  ).pipe(Effect.andThen(Effect.interrupt));
}

function requireEmptyBody(body: Buffer) {
  return body.byteLength === 0
    ? Effect.void
    : Effect.fail(new EnvironmentHttpBodyError({ _tag: "InvalidMessage" }));
}

function decodeRequestBody<S extends Schema.ConstraintDecoder<unknown, never>>(
  schema: S,
  body: Buffer,
) {
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(schema)(JSON.parse(body.toString("utf8")), {
        onExcessProperty: "error",
      }),
    catch: () => new EnvironmentHttpBodyError({ _tag: "InvalidMessage" }),
  });
}
