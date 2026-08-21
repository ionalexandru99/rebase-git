import type { IncomingMessage } from "node:http";
import type { EnvironmentAuthorizationFailure } from "@rebase/contracts";
import { EnvironmentAuthorizationError } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { Effect } from "effect";

export function validateRequestHost(request: IncomingMessage) {
  const port = request.socket.localPort;
  const expectedHost = port === undefined ? undefined : `127.0.0.1:${port}`;
  return request.headers.host === expectedHost
    ? Effect.void
    : failAuthorization({ _tag: "InvalidHost" });
}

export function validateRequestOrigin(
  request: IncomingMessage,
  required: boolean,
) {
  const origin = request.headers.origin;
  if (origin === undefined && !required) {
    return Effect.void;
  }
  return origin === expectedRequestOrigin(request)
    ? Effect.void
    : failAuthorization({ _tag: "InvalidOrigin" });
}

export function expectedRequestOrigin(request: IncomingMessage) {
  return `http://127.0.0.1:${request.socket.localPort ?? 0}`;
}

export function readBearerCredential(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

export function authorizationFailureStatus(
  failure: EnvironmentAuthorizationFailure,
) {
  switch (failure._tag) {
    case "InvalidHost":
    case "InvalidOrigin":
    case "CapabilityDenied":
      return 403;
    case "InvalidGrant":
    case "RevokedGrant":
    case "InvalidPairing":
    case "InvalidTicket":
      return 401;
    case "ExpiredGrant":
    case "ExpiredPairing":
    case "ExpiredTicket":
      return 410;
    case "PairingAlreadyUsed":
    case "TicketAlreadyUsed":
      return 409;
  }
}

function failAuthorization(failure: EnvironmentAuthorizationFailure) {
  return Effect.fail(new EnvironmentAuthorizationError(failure));
}
