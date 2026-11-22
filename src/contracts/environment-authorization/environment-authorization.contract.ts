import { z } from "zod";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";

const AuthorizationId = z.uuidv4();
const SecretMaterial = z.string().min(32).max(512);
const PairingCode = z.string().regex(/^\d{3}-\d{3}$/);
const DeviceLabel = z.string().min(1).max(128);

export const EnvironmentPairingCreated = z.object({
  pairingUrl: z.string(),
  expiresAt: IsoDate,
});
export type EnvironmentPairingCreated = z.infer<
  typeof EnvironmentPairingCreated
>;

export const ExchangeEnvironmentPairing = z.object({
  pairingMaterial: PairingCode,
  label: DeviceLabel,
});
export type ExchangeEnvironmentPairing = z.infer<
  typeof ExchangeEnvironmentPairing
>;

export const EnvironmentDeviceAuthorization = z.object({
  id: AuthorizationId,
  label: DeviceLabel,
});
export type EnvironmentDeviceAuthorization = z.infer<
  typeof EnvironmentDeviceAuthorization
>;

export const EnvironmentPairingExchanged = z.object({
  authorization: EnvironmentDeviceAuthorization,
  credential: SecretMaterial,
});
export type EnvironmentPairingExchanged = z.infer<
  typeof EnvironmentPairingExchanged
>;

export const EnvironmentBrowserSession = z.object({
  authorization: EnvironmentDeviceAuthorization,
});
export type EnvironmentBrowserSession = z.infer<
  typeof EnvironmentBrowserSession
>;

export const RevokeEnvironmentAuthorization = z.object({
  authorizationId: AuthorizationId,
});
export type RevokeEnvironmentAuthorization = z.infer<
  typeof RevokeEnvironmentAuthorization
>;

export const EnvironmentAuthorizationRevoked = z.object({
  authorizationId: AuthorizationId,
  revokedAt: IsoDate,
});
export type EnvironmentAuthorizationRevoked = z.infer<
  typeof EnvironmentAuthorizationRevoked
>;

export const InvalidHost = z.object({ _tag: z.literal("InvalidHost") });
export const InvalidOrigin = z.object({ _tag: z.literal("InvalidOrigin") });
export const InvalidGrant = z.object({ _tag: z.literal("InvalidGrant") });
export type InvalidGrant = z.infer<typeof InvalidGrant>;
export const ExpiredGrant = z.object({ _tag: z.literal("ExpiredGrant") });
export const RevokedGrant = z.object({ _tag: z.literal("RevokedGrant") });
export const InvalidPairing = z.object({ _tag: z.literal("InvalidPairing") });
export const ExpiredPairing = z.object({ _tag: z.literal("ExpiredPairing") });
export const PairingAlreadyUsed = z.object({
  _tag: z.literal("PairingAlreadyUsed"),
});

export const EnvironmentAuthorizationFailure = z.discriminatedUnion("_tag", [
  InvalidHost,
  InvalidOrigin,
  InvalidGrant,
  ExpiredGrant,
  RevokedGrant,
  InvalidPairing,
  ExpiredPairing,
  PairingAlreadyUsed,
]);
export type EnvironmentAuthorizationFailure = z.infer<
  typeof EnvironmentAuthorizationFailure
>;

export const InvalidMessage = z.object({ _tag: z.literal("InvalidMessage") });
export const PayloadTooLarge = z.object({
  _tag: z.literal("PayloadTooLarge"),
  limitBytes: z.int().nonnegative(),
});

export const EnvironmentAccessFailure = z.discriminatedUnion("_tag", [
  EnvironmentAuthorizationFailure,
  InvalidMessage,
  PayloadTooLarge,
]);
export type EnvironmentAccessFailure = z.infer<typeof EnvironmentAccessFailure>;

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
