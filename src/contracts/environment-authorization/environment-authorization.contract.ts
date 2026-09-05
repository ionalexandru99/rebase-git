import {
  EnvironmentAccessCapability,
  environmentAccessCapabilities,
} from "@rebase/contracts/environment-authorization/environment-access-capability.contract";
import {
  InvalidMessage,
  PayloadTooLarge,
} from "@rebase/contracts/environment-connection/websocket/environment-live-connection.contract";
import { Schema } from "effect";

export const environmentAuthorizationRoles = [
  "viewer",
  "contributor",
  "maintainer",
  "owner",
  "custom",
] as const;

export { EnvironmentAccessCapability, environmentAccessCapabilities };

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
const IsoDate = Schema.String;

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

export const EnvironmentGrantHttpFailure = Schema.Union([
  InvalidHost,
  InvalidOrigin,
  InvalidGrant,
  ExpiredGrant,
  RevokedGrant,
  CapabilityDenied,
  InvalidMessage,
  PayloadTooLarge,
]);
export type EnvironmentGrantHttpFailure =
  typeof EnvironmentGrantHttpFailure.Type;

export const EnvironmentPairingExchangeHttpFailure = Schema.Union([
  InvalidHost,
  InvalidOrigin,
  InvalidPairing,
  ExpiredPairing,
  PairingAlreadyUsed,
  InvalidMessage,
  PayloadTooLarge,
]);
export type EnvironmentPairingExchangeHttpFailure =
  typeof EnvironmentPairingExchangeHttpFailure.Type;

export const EnvironmentAuthorizationHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  EnvironmentPairingExchangeHttpFailure,
]);
export type EnvironmentAuthorizationHttpFailure =
  typeof EnvironmentAuthorizationHttpFailure.Type;

export const environmentPairingExchangePath =
  "/api/authorization/pairings/exchange";
export const environmentPairingsPath = "/api/authorization/pairings";
export const environmentWebSocketTicketsPath =
  "/api/authorization/websocket-tickets";
export const environmentAuthorizationRevocationPath =
  "/api/authorization/revocations";

export const EnvironmentAuthorizationHttpApi = {
  createBrowserSession: {
    failure: EnvironmentPairingExchangeHttpFailure,
    failureStatuses: [400, 401, 403, 409, 410, 413] as const,
    method: "POST",
    path: "/api/authorization/browser-session",
    request: ExchangeEnvironmentPairing,
    success: EnvironmentBrowserSession,
    successStatus: 201,
  },
  readBrowserSession: {
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413] as const,
    method: "GET",
    path: "/api/authorization/browser-session",
    success: EnvironmentBrowserSession,
    successStatus: 200,
  },
  createPairing: {
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413] as const,
    method: "POST",
    path: environmentPairingsPath,
    request: CreateEnvironmentPairing,
    success: EnvironmentPairingCreated,
    successStatus: 201,
  },
  exchangePairing: {
    failure: EnvironmentPairingExchangeHttpFailure,
    failureStatuses: [400, 401, 403, 409, 410, 413] as const,
    method: "POST",
    path: environmentPairingExchangePath,
    request: ExchangeEnvironmentPairing,
    success: EnvironmentPairingExchanged,
    successStatus: 201,
  },
  mintWebSocketTicket: {
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413] as const,
    method: "POST",
    path: environmentWebSocketTicketsPath,
    success: EnvironmentWebSocketTicket,
    successStatus: 201,
  },
  revokeAuthorization: {
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413] as const,
    method: "POST",
    path: environmentAuthorizationRevocationPath,
    request: RevokeEnvironmentAuthorization,
    success: EnvironmentAuthorizationRevoked,
    successStatus: 200,
  },
} as const;
