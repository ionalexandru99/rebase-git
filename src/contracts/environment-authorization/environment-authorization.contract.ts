import { Schema } from "effect";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";

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
export type InvalidGrant = typeof InvalidGrant.Type;
export const ExpiredGrant = Schema.TaggedStruct("ExpiredGrant", {});
export const RevokedGrant = Schema.TaggedStruct("RevokedGrant", {});
export const InvalidPairing = Schema.TaggedStruct("InvalidPairing", {});
export const ExpiredPairing = Schema.TaggedStruct("ExpiredPairing", {});
export const PairingAlreadyUsed = Schema.TaggedStruct("PairingAlreadyUsed", {});

export const EnvironmentAuthorizationFailure = Schema.Union([
  InvalidHost,
  InvalidOrigin,
  InvalidGrant,
  ExpiredGrant,
  RevokedGrant,
  InvalidPairing,
  ExpiredPairing,
  PairingAlreadyUsed,
]);
export type EnvironmentAuthorizationFailure =
  typeof EnvironmentAuthorizationFailure.Type;

export const InvalidMessage = Schema.TaggedStruct("InvalidMessage", {});
export const PayloadTooLarge = Schema.TaggedStruct("PayloadTooLarge", {
  limitBytes: Schema.Natural,
});

export const EnvironmentAccessFailure = Schema.Union([
  EnvironmentAuthorizationFailure,
  InvalidMessage,
  PayloadTooLarge,
]);
export type EnvironmentAccessFailure = typeof EnvironmentAccessFailure.Type;

export const environmentBrowserSessionPath =
  "/api/authorization/browser-session";
export const environmentPairingExchangePath =
  "/api/authorization/pairings/exchange";

export const EnvironmentAuthorizationApi = {
  createPairing: route("authorization/pairings/create", {
    success: EnvironmentPairingCreated,
  }),
  revokeAuthorization: route("authorization/revoke", {
    request: RevokeEnvironmentAuthorization,
    success: EnvironmentAuthorizationRevoked,
    failure: InvalidGrant,
  }),
};
