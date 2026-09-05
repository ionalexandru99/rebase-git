import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
} from "@rebase/contracts";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/domain/repository-history/repository-history-completion.contract";

export interface StoredCommit {
  readonly commit: RepositoryCommit;
  readonly environmentId: string;
  readonly key: string;
  readonly repositoryId: string;
  readonly topologicalEpoch?: number;
  readonly topologicalOrder?: number;
}

export interface StoredHistoryPage {
  readonly offset?: number;
  readonly exhausted?: boolean;
  readonly scopeKey?: string;
  readonly oids: readonly string[];
  readonly order: "topological" | "chronological";
  readonly requestedLimit: number;
  readonly rootOids: readonly string[];
}

export interface StoredRepository {
  readonly cacheFormatVersion?: number;
  readonly lastOpenedAt?: number;
  readonly cachedPage?: StoredHistoryPage;
  readonly foregroundPages?: readonly StoredHistoryPage[];
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly environmentId: string;
  readonly key: string;
  readonly minimumTopologicalEpoch: number;
  readonly objectFormat: "sha1" | "sha256";
  readonly pendingTopologicalEpoch?: number;
  readonly pendingTopologicalOrder?: number;
  readonly pendingSnapshot?: RepositoryHistorySnapshot;
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly repositoryId: string;
}
