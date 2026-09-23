import type { RepositoryHistoryCacheReader } from "#web/features/history-storage/index";
import type { RepositoryHistoryFetchCommands } from "#web/features/repository-history/index";

export type RepositoryHistorySettingsClient = RepositoryHistoryCacheReader &
  Pick<RepositoryHistoryFetchCommands, "configureFetch">;

export interface RepositorySettingsIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}
