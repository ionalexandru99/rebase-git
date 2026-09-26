import {
  EnvironmentAccessCapability,
  environmentAccessCapabilities,
} from "@rebase/contracts/environment-connection/environment-access-capability.contract";
import { EnvironmentHttpFailure } from "@rebase/contracts/environment-connection/environment-request-failure.contract";
import {
  type EnvironmentHttpRoute,
  route,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import { IsoDate } from "@rebase/contracts/environment-connection/iso-date.contract";
import { Schema } from "effect";

export const environmentAuthorizationRoles = [
  "viewer",
  "contributor",
  "maintainer",
  "owner",
  "custom",
] as const;

export const EnvironmentAuthorizationRole = Schema.Literals(
  environmentAuthorizationRoles,
);
export type EnvironmentAuthorizationRole =
  typeof EnvironmentAuthorizationRole.Type;

const AuthorizationId = Schema.String.check(Schema.isUUID(4));
const SecretMaterial = Schema.String.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(512),
);
const PairingCode = Schema.String.check(Schema.isPattern(/^\d{3}-\d{3}$/));
const DeviceLabel = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
);

export const CreateEnvironmentPairing = Schema.Struct({
  role: EnvironmentAuthorizationRole,
  capabilities: Schema.Array(EnvironmentAccessCapability).check(
    Schema.isMaxLength(environmentAccessCapabilities.length),
  ),
});
export type CreateEnvironmentPairing = typeof CreateEnvironmentPairing.Type;

export const EnvironmentPairingCreated = Schema.Struct({
  pairingUrl: Schema.String,
  expiresAt: IsoDate,
});
export type EnvironmentPairingCreated = typeof EnvironmentPairingCreated.Type;

export const ExchangeEnvironmentPairing = Schema.Struct({
  pairingMaterial: PairingCode,
  label: DeviceLabel,
});
export type ExchangeEnvironmentPairing = typeof ExchangeEnvironmentPairing.Type;

export const EnvironmentDeviceAuthorization = Schema.Struct({
  id: AuthorizationId,
  label: DeviceLabel,
  role: EnvironmentAuthorizationRole,
  capabilities: Schema.Array(EnvironmentAccessCapability),
});
export type EnvironmentDeviceAuthorization =
  typeof EnvironmentDeviceAuthorization.Type;

export const EnvironmentPairingExchanged = Schema.Struct({
  authorization: EnvironmentDeviceAuthorization,
  credential: SecretMaterial,
});
export type EnvironmentPairingExchanged =
  typeof EnvironmentPairingExchanged.Type;

export const EnvironmentBrowserSession = Schema.Struct({
  authorization: EnvironmentDeviceAuthorization,
});
export type EnvironmentBrowserSession = typeof EnvironmentBrowserSession.Type;

export const EnvironmentWebSocketTicket = Schema.Struct({
  expiresAt: IsoDate,
  ticket: SecretMaterial,
});
export type EnvironmentWebSocketTicket = typeof EnvironmentWebSocketTicket.Type;

export const RevokeEnvironmentAuthorization = Schema.Struct({
  authorizationId: AuthorizationId,
});
export type RevokeEnvironmentAuthorization =
  typeof RevokeEnvironmentAuthorization.Type;

export const EnvironmentAuthorizationRevoked = Schema.Struct({
  authorizationId: AuthorizationId,
  revokedAt: IsoDate,
});
export type EnvironmentAuthorizationRevoked =
  typeof EnvironmentAuthorizationRevoked.Type;

export const InvalidHost = Schema.TaggedStruct("InvalidHost", {});
export const InvalidOrigin = Schema.TaggedStruct("InvalidOrigin", {});
export const InvalidGrant = Schema.TaggedStruct("InvalidGrant", {});
export const ExpiredGrant = Schema.TaggedStruct("ExpiredGrant", {});
export const RevokedGrant = Schema.TaggedStruct("RevokedGrant", {});
export const CapabilityDenied = Schema.TaggedStruct("CapabilityDenied", {
  capability: EnvironmentAccessCapability,
});
export const InvalidPairing = Schema.TaggedStruct("InvalidPairing", {});
export const ExpiredPairing = Schema.TaggedStruct("ExpiredPairing", {});
export const PairingAlreadyUsed = Schema.TaggedStruct("PairingAlreadyUsed", {});
export const InvalidTicket = Schema.TaggedStruct("InvalidTicket", {});
export const ExpiredTicket = Schema.TaggedStruct("ExpiredTicket", {});
export const TicketAlreadyUsed = Schema.TaggedStruct("TicketAlreadyUsed", {});

export const EnvironmentAuthorizationFailure = Schema.Union([
  InvalidHost,
  InvalidOrigin,
  InvalidGrant,
  ExpiredGrant,
  RevokedGrant,
  CapabilityDenied,
  InvalidPairing,
  ExpiredPairing,
  PairingAlreadyUsed,
  InvalidTicket,
  ExpiredTicket,
  TicketAlreadyUsed,
]);
export type EnvironmentAuthorizationFailure =
  typeof EnvironmentAuthorizationFailure.Type;

export const EnvironmentAccessFailure = Schema.Union([
  EnvironmentAuthorizationFailure,
  EnvironmentHttpFailure,
]);
export type EnvironmentAccessFailure = typeof EnvironmentAccessFailure.Type;

export const environmentPairingExchangePath =
  "/api/authorization/pairings/exchange";
export const environmentPairingsPath = "/api/authorization/pairings";
export const environmentWebSocketTicketsPath =
  "/api/authorization/websocket-tickets";
export const environmentAuthorizationRevocationPath =
  "/api/authorization/revocations";

export const EnvironmentAuthorizationHttpApi = {
  createBrowserSession: route({
    capability: null,
    method: "POST",
    path: "/api/authorization/browser-session",
    request: ExchangeEnvironmentPairing,
    success: EnvironmentBrowserSession,
  }),
  readBrowserSession: route({
    capability: "environment.read",
    method: "GET",
    path: "/api/authorization/browser-session",
    success: EnvironmentBrowserSession,
  }),
  createPairing: route({
    capability: "authorization.manage",
    method: "POST",
    path: environmentPairingsPath,
    request: CreateEnvironmentPairing,
    success: EnvironmentPairingCreated,
  }),
  exchangePairing: route({
    capability: null,
    method: "POST",
    path: environmentPairingExchangePath,
    request: ExchangeEnvironmentPairing,
    success: EnvironmentPairingExchanged,
  }),
  mintWebSocketTicket: route({
    capability: "environment.read",
    method: "POST",
    path: environmentWebSocketTicketsPath,
    success: EnvironmentWebSocketTicket,
  }),
  revokeAuthorization: route({
    capability: "authorization.manage",
    method: "POST",
    path: environmentAuthorizationRevocationPath,
    request: RevokeEnvironmentAuthorization,
    success: EnvironmentAuthorizationRevoked,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
