import type {
  RepositoryFetchSetting,
  RepositoryFreshness,
} from "@rebase/contracts";
import { Context, type Effect } from "effect";
import type { RepositoryHistoryError } from "#server/domain/repository-history.contract";

export interface RepositoryFreshnessService {
  readonly subscribe: (
    repositoryId: string,
    publish: (freshness: RepositoryFreshness) => void,
    authorization?: { readonly automaticFetch: boolean },
  ) => Effect.Effect<Effect.Effect<void>, RepositoryHistoryError>;
  readonly fetch: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryFreshness, RepositoryHistoryError>;
  readonly configure: (
    repositoryId: string,
    setting: RepositoryFetchSetting,
  ) => Effect.Effect<RepositoryFreshness, RepositoryHistoryError>;
}

export class RepositoryFreshnessState extends Context.Service<
  RepositoryFreshnessState,
  RepositoryFreshnessService
>()("RepositoryFreshnessState") {}
