import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryCacheManagement,
} from "#web/domain/repository-history/history-storage.contract";
import type { RepositoryHistoryObservation } from "#web/features/repository-history/repository-history-reader.contract";

export type RepositoryHistoryCacheReader = RepositoryHistoryCacheManagement &
  RepositoryHistoryObservation;

export interface RepositoryHistoryCacheIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}

export interface RepositoryHistoryCacheProps {
  readonly reader: RepositoryHistoryCacheReader;
  readonly identity: RepositoryHistoryCacheIdentity;
  readonly repositoryName: string;
  readonly onCacheChanged: (
    action: RepositoryHistoryCacheAction,
    identity?: RepositoryHistoryCacheIdentity,
  ) => void | Promise<void>;
}
