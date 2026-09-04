import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistoryCacheAction } from "#web/features/repository-history/repository-history-storage.contract";

export interface RepositoryHistoryCacheIdentity {
  readonly environmentId: string;
  readonly repositoryId: string;
}

export interface RepositoryHistoryCacheDialogProps {
  readonly reader: RepositoryHistoryReader;
  readonly identity: RepositoryHistoryCacheIdentity;
  readonly repositoryName: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCacheChanged: (
    action: RepositoryHistoryCacheAction,
    identity?: RepositoryHistoryCacheIdentity,
  ) => void | Promise<void>;
}
