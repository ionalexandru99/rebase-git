import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { RepositoryHistoryError } from "#server/domain/repository-history.contract";

export interface RepositoryFreshnessService {
  readonly subscribe: (
    repositoryId: string,
    publish: (freshness: RepositoryFreshness) => void,
  ) => Effect.Effect<() => void, RepositoryHistoryError>;
  readonly fetch: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryFreshness, RepositoryHistoryError>;
  readonly configure: (
    repositoryId: string,
    setting: RepositoryFetchSetting,
  ) => Effect.Effect<RepositoryFreshness, RepositoryHistoryError>;
}
