import type {
  RepositoryHistoryFailed,
  RepositoryHistorySynchronized,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { RepositoryHistoryTransport } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryFreshnessTransportRuntime } from "#web/features/repository-history/transport/repository-freshness.contract";

export interface RepositoryHistoryTransportRuntime
  extends RepositoryHistoryTransport {
  readonly freshness: RepositoryFreshnessTransportRuntime;
  readonly acceptBinary: (
    frame: Uint8Array,
  ) => Effect.Effect<void, EnvironmentConnectionFailure>;
  readonly acceptFailure: (
    message: RepositoryHistoryFailed,
  ) => Effect.Effect<void, EnvironmentConnectionFailure>;
  readonly acceptSynchronized: (
    message: RepositoryHistorySynchronized,
  ) => Effect.Effect<void, EnvironmentConnectionFailure>;
  readonly close: (
    failure: EnvironmentConnectionFailure,
  ) => Effect.Effect<void>;
}
