import type { EnvironmentDiscovery } from "@rebase/contracts";
import type { EnvironmentConnectionFailure } from "@rebase/environment-client";
import type { Effect } from "effect";
import type { RepositoryHistoryTransport } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport.contract";

import type { NegotiatedEnvironment } from "#web/platform/environment/environment-protocol.contract";

export interface EnvironmentProtocolConnection {
  readonly close: () => void;
  readonly closed: Effect.Effect<EnvironmentConnectionFailure>;
  readonly currentSequence: () => number;
  readonly discovery: EnvironmentDiscovery;
  readonly negotiated: NegotiatedEnvironment;
  readonly repositoryHistory: RepositoryHistoryTransport;
  readonly repositoryRefs: RepositoryRefsTransport;
  readonly subscribeChanges: (
    listener: (repositoryIds?: readonly string[]) => void,
  ) => () => void;
  readonly waitForSequence: (
    sequence: number,
  ) => Effect.Effect<number, EnvironmentConnectionFailure>;
}
