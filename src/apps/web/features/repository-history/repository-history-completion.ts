import { maximumRepositoryHistorySequence } from "@rebase/contracts/repository-history/repository-history-limits.contract";
import type {
  RepositoryHistoryCompletionBasis,
  RepositoryHistorySynchronizationProgress,
} from "#web/features/repository-history/repository-history-completion.contract";

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
  if (sequence >= maximumRepositoryHistorySequence) {
    throw new Error("Repository history batch sequence is exhausted");
  }
  return {
    committedCommitCount: progress.committedCommitCount + commitCount,
    nextBatchSequence: sequence + 1,
  };
}
