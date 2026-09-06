import type { EnvironmentDiscovery, EnvironmentHello } from "@rebase/contracts";
import type { Queue, Ref } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import type { NegotiatedEnvironment } from "#web/features/environment-connection/environment-protocol-connection.contract";
import type { EnvironmentConnectionState } from "#web/features/environment-connection/websocket/environment-connection-state";
import type { EnvironmentSocketEvent } from "#web/features/environment-connection/websocket/environment-socket.contract";
import type { RepositoryHistoryTransportRuntime } from "#web/features/repository-history/transport/repository-history-transport.contract";
import type { RepositoryRefsTransportRuntime } from "#web/features/repository-refs/transport/repository-refs-transport.contract";

export interface EnvironmentLiveSession {
  readonly credential: EnvironmentCredential;
  readonly discovery: EnvironmentDiscovery;
  readonly events: Queue.Dequeue<
    EnvironmentSocketEvent,
    EnvironmentConnectionFailure
  >;
  readonly hello: EnvironmentHello;
  readonly negotiated: NegotiatedEnvironment;
  readonly origin: string;
  readonly repositoryHistory: RepositoryHistoryTransportRuntime;
  readonly repositoryRefs: RepositoryRefsTransportRuntime;
  readonly signal: AbortSignal;
  readonly socket: WebSocket;
  readonly state: Ref.Ref<EnvironmentConnectionState>;
}
