import type { Effect, Scope } from "effect";
import type {
  EnvironmentAuthorizationRejected,
  EnvironmentConnectionFailure,
} from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentProtocolConnection } from "#web/features/environment-connection/environment-protocol-connection.contract";

export type LocalEnvironmentSessionState =
  | { readonly _tag: "PairingRequired" }
  | { readonly _tag: "Authorizing" }
  | { readonly _tag: "Connecting" }
  | {
      readonly _tag: "Connected";
      readonly environmentId: string;
    }
  | {
      readonly _tag: "Reconnecting";
      readonly attempt: number;
    }
  | {
      readonly _tag: "AuthorizationFailed";
      readonly failure: EnvironmentAuthorizationRejected;
    }
  | {
      readonly _tag: "ProtocolMismatch";
      readonly message: string;
    };

export interface LocalEnvironmentSession {
  readonly getSnapshot: () => LocalEnvironmentSessionState;
  readonly start: () => void;
  readonly stop: () => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface LocalEnvironmentGateway {
  readonly connect: (
    credential: string,
    lastObservedSequence: number | undefined,
  ) => Effect.Effect<
    EnvironmentProtocolConnection,
    EnvironmentConnectionFailure,
    Scope.Scope
  >;
  readonly exchangePairing: (
    pairingMaterial: string,
  ) => Effect.Effect<
    { readonly credential: string },
    EnvironmentConnectionFailure
  >;
}

export interface LocalEnvironmentSessionOptions {
  readonly gateway: LocalEnvironmentGateway;
  readonly pairingMaterial: string | undefined;
  readonly pairingSucceeded?: () => void;
  readonly waitBeforeReconnect?: (attempt: number) => Effect.Effect<void>;
}
