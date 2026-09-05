import type { RepositoryHistoryClientMessage } from "@rebase/contracts";
import type { Effect } from "effect";
import type {
  EnvironmentWebSocketSessionRejected,
  EnvironmentWebSocketWriteError,
} from "#server/features/environment-connection/websocket/environment-websocket-error.contract";

export interface RepositoryHistorySession {
  readonly handle: (
    message: RepositoryHistoryClientMessage,
  ) => Effect.Effect<
    void,
    EnvironmentWebSocketSessionRejected | EnvironmentWebSocketWriteError
  >;
}
