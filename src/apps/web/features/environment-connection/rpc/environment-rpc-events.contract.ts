import type { EnvironmentDiscovery, EnvironmentHello } from "@rebase/contracts";
import type { EnvironmentRpcClient } from "@rebase/contracts/environment-connection/rpc/environment-rpc.contract";
import type { Ref } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import type { NegotiatedEnvironment } from "#web/features/environment-connection/environment-protocol-connection.contract";
import type { EnvironmentConnectionState } from "#web/features/environment-connection/websocket/environment-connection-state";

export interface EnvironmentRpcEvents {
  readonly client: EnvironmentRpcClient;
  readonly credential: EnvironmentCredential;
  readonly discovery: EnvironmentDiscovery;
  readonly hello: EnvironmentHello;
  readonly negotiated: NegotiatedEnvironment;
  readonly origin: string;
  readonly signal: AbortSignal;
  readonly state: Ref.Ref<EnvironmentConnectionState>;
}
