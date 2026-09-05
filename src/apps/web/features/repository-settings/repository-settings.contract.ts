import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export type RepositoryHistoryOrder = RepositoryHistoryQuery["order"];

export interface RepositorySettingsIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}
