export interface RepositoryHistorySynchronizationProgress {
  readonly committedCommitCount: number;
  readonly nextBatchSequence: number;
}

export interface RepositoryHistoryCompletionBasis {
  readonly commitCount: number;
}

export function completeRepositoryHistory(
  progress: RepositoryHistorySynchronizationProgress,
  reportedCommitCount: number,
): RepositoryHistoryCompletionBasis {
  if (progress.committedCommitCount !== reportedCommitCount) {
    throw new Error(
      "Repository history completion count does not match storage",
    );
  }
  return { commitCount: reportedCommitCount };
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
