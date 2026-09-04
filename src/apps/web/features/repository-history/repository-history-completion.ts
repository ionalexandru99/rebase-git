import type { RepositoryHistorySnapshot } from "@rebase/contracts";

export interface RepositoryHistorySynchronizationProgress {
  readonly committedCommitCount: number;
  readonly nextBatchSequence: number;
}

export interface RepositoryHistoryCompletionBasis {
  readonly commitCount: number;
  readonly snapshot?: Omit<RepositoryHistorySnapshot, "resumable">;
}

export function completeRepositoryHistory(
  progress: RepositoryHistorySynchronizationProgress,
  reportedCommitCount: number,
  snapshot?: NonNullable<RepositoryHistoryCompletionBasis["snapshot"]>,
): RepositoryHistoryCompletionBasis {
  if (progress.committedCommitCount !== reportedCommitCount) {
    throw new Error(
      "Repository history completion count does not match storage",
    );
  }
  return {
    commitCount: reportedCommitCount,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

export function acceptRepositoryHistoryBatch(
  progress: RepositoryHistorySynchronizationProgress,
  sequence: number,
  commitCount: number,
): RepositoryHistorySynchronizationProgress {
  if (sequence < progress.nextBatchSequence) {
    return progress;
  }
  if (sequence !== progress.nextBatchSequence) {
    throw new Error("Repository history batch sequence is incomplete");
  }
  return {
    committedCommitCount: progress.committedCommitCount + commitCount,
    nextBatchSequence: sequence + 1,
  };
}
