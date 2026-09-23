import type {
  AuthorizationDenied,
  EnvironmentAccessCapability,
  EnvironmentCapabilityName,
  HelloAccepted,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentTransportState } from "#server/adapters/environment-transport/environment-connection.contract";

export interface EnvironmentRpcSession {
  readonly state: EnvironmentTransportState;
  readonly requireCapability: (
    name: EnvironmentCapabilityName,
    access?: EnvironmentAccessCapability,
  ) => Effect.Effect<HelloAccepted, AuthorizationDenied>;
}
