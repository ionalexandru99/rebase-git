import type { RepositoryHistoryObservation } from "#web/features/repository-history/repository-history-reader.contract";
import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryCacheManagement,
} from "#web/features/repository-history/repository-history-storage.contract";

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
