import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
  RepositoryHistoryFailed,
  RepositoryHistoryFreshness,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type {
  RepositoryHistoryRejected,
  RepositoryHistoryUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

export type RepositoryFreshnessFailure =
  | EnvironmentConnectionFailure
  | RepositoryHistoryRejected
  | RepositoryHistoryUnavailable;

export interface RepositoryFreshnessTransport {
  readonly observe: (
    repositoryId: string,
    publish: (state: RepositoryFreshness) => void,
  ) => Effect.Effect<never, RepositoryFreshnessFailure>;
  readonly fetch: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryFreshness, RepositoryFreshnessFailure>;
  readonly configure: (
    repositoryId: string,
    setting: RepositoryFetchSetting,
  ) => Effect.Effect<RepositoryFreshness, RepositoryFreshnessFailure>;
}

export interface RepositoryFreshnessTransportRuntime
  extends RepositoryFreshnessTransport {
  readonly accept: (message: RepositoryHistoryFreshness) => Effect.Effect<void>;
  readonly acceptFailure: (
    message: RepositoryHistoryFailed,
  ) => Effect.Effect<void>;
  readonly close: (error: EnvironmentConnectionFailure) => Effect.Effect<void>;
}

export interface RepositoryFreshnessGateway {
  readonly subscribe: (
    repositoryId: string,
    publish: (state: RepositoryFreshness) => void,
    fail: (error: unknown) => void,
  ) => () => void;
  readonly fetch: (
    repositoryId: string,
    signal?: AbortSignal,
  ) => Promise<RepositoryFreshness>;
  readonly configure: (
    repositoryId: string,
    setting: RepositoryFetchSetting,
    signal?: AbortSignal,
  ) => Promise<RepositoryFreshness>;
}
