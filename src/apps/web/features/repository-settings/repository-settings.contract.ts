import type {
  RepositoryHistoryCacheReader,
  RepositoryHistoryFetchCommands,
} from "#web/features/repository-history/index";

export type RepositoryHistorySettingsClient = RepositoryHistoryCacheReader &
  Pick<RepositoryHistoryFetchCommands, "configureFetch">;

export interface RepositorySettingsIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}
