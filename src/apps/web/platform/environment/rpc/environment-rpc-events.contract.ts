import type {
  EnvironmentDiscovery,
  EnvironmentHello,
  EnvironmentRpcClient,
} from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import type { Ref } from "effect";
import type { NegotiatedEnvironment } from "#web/platform/environment/environment-protocol.contract";
import type { EnvironmentConnectionState } from "#web/platform/environment/websocket/environment-connection-state";

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
