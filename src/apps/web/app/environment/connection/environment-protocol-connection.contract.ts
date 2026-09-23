import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { EnvironmentConnectionFailure } from "@rebase/environment-client";
import type { Effect } from "effect";
import type {
  EnvironmentChangeListener,
  NegotiatedEnvironmentRpc,
} from "#web/platform/environment/environment-protocol.contract";

export interface EnvironmentProtocolConnection
  extends NegotiatedEnvironmentRpc {
  readonly close: () => void;
  readonly closed: Effect.Effect<EnvironmentConnectionFailure>;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly subscribeChanges: (
    listener: EnvironmentChangeListener,
  ) => () => void;
  readonly waitForSequence: (
    sequence: number,
  ) => Effect.Effect<number, EnvironmentConnectionFailure>;
}
