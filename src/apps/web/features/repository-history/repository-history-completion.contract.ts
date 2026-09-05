import type { RepositoryHistorySnapshot } from "@rebase/contracts";

export interface RepositoryHistorySynchronizationProgress {
  readonly committedCommitCount: number;
  readonly nextBatchSequence: number;
}

export interface RepositoryHistoryCompletionBasis {
  readonly commitCount: number;
  readonly snapshot?: Omit<RepositoryHistorySnapshot, "resumable">;
}
