import type { EnvironmentDiscovery, EnvironmentHello } from "@rebase/contracts";
import type { Queue, Ref } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { NegotiatedEnvironment } from "#web/features/environment-connection/environment-protocol-connection.contract";
import type { EnvironmentConnectionState } from "#web/features/environment-connection/websocket/environment-connection-state";
import type { EnvironmentSocketEvent } from "#web/features/environment-connection/websocket/environment-socket.contract";

export interface EnvironmentLiveSession {
  readonly credential: string;
  readonly discovery: EnvironmentDiscovery;
  readonly events: Queue.Dequeue<
    EnvironmentSocketEvent,
    EnvironmentConnectionFailure
  >;
  readonly hello: EnvironmentHello;
  readonly negotiated: NegotiatedEnvironment;
  readonly origin: string;
  readonly signal: AbortSignal;
  readonly socket: WebSocket;
  readonly state: Ref.Ref<EnvironmentConnectionState>;
}
