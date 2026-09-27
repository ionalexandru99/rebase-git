import type { IncomingMessage, ServerResponse } from "node:http";
import { isIPv4 } from "node:net";
import {
  type EnvironmentAccessFailure,
  environmentSubprotocol,
} from "@rebase/contracts";
import { Effect } from "effect";
import { EnvironmentAuthorizationError } from "#server/features/environment-authorization/environment-authorization";

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
  if (origin === undefined && !required) return Effect.void;
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

export function readSocketCredential(request: IncomingMessage) {
  const bearer = request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol !== environmentSubprotocol);
  return bearer === undefined
    ? { credential: readBrowserSessionCredential(request), cookie: true }
    : { credential: bearer, cookie: false };
}

export function writeBrowserSessionCookie(
  request: IncomingMessage,
  response: ServerResponse,
  credential: string,
) {
  response.setHeader(
    "set-cookie",
    `${cookieName(request)}=${credential}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${90 * 24 * 60 * 60}`,
  );
}

export function accessFailureStatus(failure: EnvironmentAccessFailure) {
  switch (failure._tag) {
    case "InvalidMessage":
      return 400;
    case "PayloadTooLarge":
      return 413;
    case "InvalidHost":
    case "InvalidOrigin":
      return 403;
    case "InvalidGrant":
    case "RevokedGrant":
    case "InvalidPairing":
      return 401;
    case "ExpiredGrant":
    case "ExpiredPairing":
      return 410;
    case "PairingAlreadyUsed":
      return 409;
  }
}

function readBrowserSessionCredential(request: IncomingMessage) {
  const prefix = `${cookieName(request)}=`;
  return request.headers.cookie
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function cookieName(request: IncomingMessage) {
  return `rebase_session_${request.socket.localPort}`;
}

function listeningHost(request: IncomingMessage) {
  const { localAddress, localPort } = request.socket;
  return localAddress === undefined || localPort === undefined
    ? undefined
    : `${formatHostAddress(localAddress)}:${localPort}`;
}

function failAuthorization(failure: EnvironmentAuthorizationError["failure"]) {
  return Effect.fail(new EnvironmentAuthorizationError({ failure }));
}
