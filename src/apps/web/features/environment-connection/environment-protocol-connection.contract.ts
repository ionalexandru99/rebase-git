import type {
  EnvironmentDiscovery,
  EnvironmentHelloResult,
} from "@rebase/contracts";

export type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;

export interface EnvironmentProtocolConnection {
  readonly close: () => void;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly negotiated: NegotiatedEnvironment;
  readonly waitForSequence: (sequence: number) => Promise<number>;
}
