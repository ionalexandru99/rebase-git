import type {
  EnvironmentDiscovery,
  EnvironmentHelloResult,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { RepositoryHistoryTransport } from "#web/features/repository-history/repository-history-reader.contract";

export type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;

export interface EnvironmentProtocolConnection {
  readonly close: () => void;
  readonly closed: Effect.Effect<EnvironmentConnectionFailure>;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly negotiated: NegotiatedEnvironment;
  readonly repositoryHistory: RepositoryHistoryTransport;
  readonly subscribeChanges: (
    listener: (repositoryIds?: readonly string[]) => void,
  ) => () => void;
  readonly waitForSequence: (
    sequence: number,
  ) => Effect.Effect<number, EnvironmentConnectionFailure>;
}
