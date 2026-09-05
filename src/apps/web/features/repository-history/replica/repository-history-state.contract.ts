import type {
  RepositoryHistoryRefTarget,
  RepositoryHistorySnapshot,
} from "@rebase/contracts";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/domain/repository-history/repository-history-completion.contract";

export interface StoredRepositoryHistoryState {
  readonly completion?: RepositoryHistoryCompletionBasis;
  readonly objectFormat: "sha1" | "sha256";
  readonly refTargets: readonly RepositoryHistoryRefTarget[];
  readonly progress: RepositoryHistorySynchronizationProgress;
  readonly pendingSnapshot?: RepositoryHistorySnapshot;
}
