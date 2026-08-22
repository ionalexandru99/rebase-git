import type {
  EnvironmentDiscovery,
  EnvironmentHelloResult,
} from "@rebase/contracts";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";

export type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;

export interface EnvironmentProtocolConnection {
  readonly close: () => void;
  readonly closed: Promise<EnvironmentConnectionFailure>;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly negotiated: NegotiatedEnvironment;
  readonly waitForSequence: (sequence: number) => Promise<number>;
}
