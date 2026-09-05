import type {
  BinaryLogicalMessage,
  EnvironmentServerMessage,
  TransportLimits,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentWebSocketWriteError } from "#server/features/environment-connection/websocket/environment-websocket-error.contract";

export interface EnvironmentWebSocketWriter {
  readonly acknowledgeSnapshot: (
    sequence: number,
  ) => Effect.Effect<boolean, EnvironmentWebSocketWriteError>;
  readonly send: (
    message: EnvironmentServerMessage,
  ) => Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly sendBinary: (
    message: BinaryLogicalMessage,
  ) => Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly enqueue: (
    message: EnvironmentServerMessage,
  ) => Effect.Effect<boolean, EnvironmentWebSocketWriteError>;
  readonly flush: Effect.Effect<void, EnvironmentWebSocketWriteError>;
  readonly setNegotiatedContract: (
    negotiatedLimits: TransportLimits,
    negotiatedSupportsResnapshot: boolean,
  ) => Effect.Effect<void>;
}
