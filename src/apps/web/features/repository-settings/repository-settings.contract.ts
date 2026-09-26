import type { RepositoryHistoryCacheReader } from "#web/features/history-storage/history-cache.contract";
import type { RepositoryHistoryFetchCommands } from "#web/features/repository-history/repository-history-reader.contract";

export type RepositoryHistorySettingsClient = RepositoryHistoryCacheReader &
  Pick<RepositoryHistoryFetchCommands, "configureFetch">;

export interface RepositorySettingsIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}
