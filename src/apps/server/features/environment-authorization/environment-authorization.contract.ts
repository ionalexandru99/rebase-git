import type {
  CreateEnvironmentPairing,
  EnvironmentAccessCapability,
  EnvironmentAuthorizationFailure,
  EnvironmentAuthorizationRevoked,
  EnvironmentDeviceAuthorization,
  EnvironmentPairingExchanged,
  ExchangeEnvironmentPairing,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentStorageError } from "#server/persistence/storage/storage-error.contract";

export interface EnvironmentPairingMaterial {
  readonly expiresAt: string;
  readonly material: string;
}

export interface EnvironmentTicketMaterial {
  readonly expiresAt: string;
  readonly ticket: string;
}

export interface EnvironmentAuthorization {
  readonly authorize: (
    credential: string | undefined,
    capability: EnvironmentAccessCapability,
  ) => Effect.Effect<
    EnvironmentDeviceAuthorization,
    EnvironmentAuthorizationError | EnvironmentStorageError
  >;
  readonly consumeTicket: (
    ticket: string | undefined,
  ) => Effect.Effect<
    EnvironmentDeviceAuthorization,
    EnvironmentAuthorizationError | EnvironmentStorageError
  >;
  readonly createPairing: (
    pairing: CreateEnvironmentPairing,
  ) => Effect.Effect<EnvironmentPairingMaterial>;
  readonly exchangePairing: (
    exchange: ExchangeEnvironmentPairing,
  ) => Effect.Effect<
    EnvironmentPairingExchanged,
    EnvironmentAuthorizationError | EnvironmentStorageError
  >;
  readonly mintTicket: (
    credential: string | undefined,
  ) => Effect.Effect<
    EnvironmentTicketMaterial,
    EnvironmentAuthorizationError | EnvironmentStorageError
  >;
  readonly revoke: (
    credential: string | undefined,
    authorizationId: string,
  ) => Effect.Effect<
    EnvironmentAuthorizationRevoked,
    EnvironmentAuthorizationError | EnvironmentStorageError
  >;
}

export interface EnvironmentAuthorizationClock {
  readonly now: () => Date;
}

export interface EnvironmentAuthorizationOptions {
  readonly clock?: EnvironmentAuthorizationClock;
}

export class EnvironmentAuthorizationError {
  readonly _tag = "EnvironmentAuthorizationError";
  readonly failure: EnvironmentAuthorizationFailure;

  constructor(failure: EnvironmentAuthorizationFailure) {
    this.failure = failure;
  }
}

export function isEnvironmentAuthorizationError(
  value: unknown,
): value is EnvironmentAuthorizationError {
  return value instanceof EnvironmentAuthorizationError;
}
