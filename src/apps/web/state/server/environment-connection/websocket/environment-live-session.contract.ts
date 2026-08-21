import type { EnvironmentDiscovery, EnvironmentHello } from "@rebase/contracts";
import type { EnvironmentConnectionFailure } from "@rebase/web/state/server/environment-connection/environment-connection-errors";
import type { EnvironmentConnectionState } from "@rebase/web/state/server/environment-connection/websocket/environment-connection-state";
import type { NegotiatedEnvironment } from "@rebase/web/state/server/environment-connection/websocket/environment-protocol-connection.contract";
import type { EnvironmentSocketEvent } from "@rebase/web/state/server/environment-connection/websocket/environment-socket.contract";
import type { Queue, Ref } from "effect";

export interface EnvironmentLiveSession {
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
