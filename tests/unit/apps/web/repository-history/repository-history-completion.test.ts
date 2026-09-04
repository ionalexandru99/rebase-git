import { describe, expect, it } from "vitest";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
} from "#web/features/repository-history/repository-history-completion";

describe("repository history completion", () => {
  it("completes only from IndexedDB-committed progress", () => {
    const progress = acceptRepositoryHistoryBatch(
      { committedCommitCount: 0, nextBatchSequence: 0 },
      0,
      256,
    );

    expect(completeRepositoryHistory(progress, 256)).toEqual({
      commitCount: 256,
    });
    expect(() => completeRepositoryHistory(progress, 257)).toThrow(
      "completion count does not match storage",
    );
  });

  it("ignores repeated batches and rejects gaps", () => {
    const progress = acceptRepositoryHistoryBatch(
      { committedCommitCount: 0, nextBatchSequence: 0 },
      0,
      12,
    );

    expect(acceptRepositoryHistoryBatch(progress, 0, 12)).toBe(progress);
    expect(() => acceptRepositoryHistoryBatch(progress, 2, 12)).toThrow(
      "batch sequence is incomplete",
    );
  });
});
