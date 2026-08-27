import type { IncomingMessage } from "node:http";
import { isIPv4 } from "node:net";
import type { EnvironmentAuthorizationFailure } from "@rebase/contracts";
import { Effect } from "effect";
import { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization.contract";

export function validateRequestHost(request: IncomingMessage) {
  const expectedHost = listeningHost(request);
  return expectedHost !== undefined && request.headers.host === expectedHost
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
  return `http://${listeningHost(request) ?? "127.0.0.1:0"}`;
}

export function formatHostAddress(address: string) {
  const unmapped =
    address.startsWith("::ffff:") && isIPv4(address.slice("::ffff:".length))
      ? address.slice("::ffff:".length)
      : address;
  return unmapped.includes(":") ? `[${unmapped}]` : unmapped;
}

function listeningHost(request: IncomingMessage) {
  const { localAddress, localPort } = request.socket;
  return localAddress === undefined || localPort === undefined
    ? undefined
    : `${formatHostAddress(localAddress)}:${localPort}`;
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
  return Effect.fail(new EnvironmentAuthorizationError({ failure }));
}
