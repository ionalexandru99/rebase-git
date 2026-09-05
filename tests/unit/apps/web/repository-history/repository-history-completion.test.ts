import { maximumRepositoryHistorySequence } from "@rebase/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptRepositoryHistoryBatch,
  completeRepositoryHistory,
} from "#web/features/repository-history/replica/repository-history-completion";

const snapshot = {
  id: "a".repeat(64),
  objectFormat: "sha1" as const,
  refTargets: [{ name: "main", oid: "b".repeat(40), type: "branch" as const }],
  rootOids: ["b".repeat(40)],
};

describe("repository history completion", () => {
  it("completes only from IndexedDB-committed progress", () => {
    const progress = acceptRepositoryHistoryBatch(
      { committedCommitCount: 0, nextBatchSequence: 0 },
      0,
      256,
    );

    expect(completeRepositoryHistory(progress, 256, snapshot)).toEqual({
      commitCount: 256,
      snapshot,
    });
    expect(() => completeRepositoryHistory(progress, 257, snapshot)).toThrow(
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

  it("stops before the persisted batch sequence overflows", () => {
    const finalProgress = acceptRepositoryHistoryBatch(
      {
        committedCommitCount: 10,
        nextBatchSequence: maximumRepositoryHistorySequence - 1,
      },
      maximumRepositoryHistorySequence - 1,
      1,
    );

    expect(finalProgress.nextBatchSequence).toBe(
      maximumRepositoryHistorySequence,
    );
    expect(() =>
      acceptRepositoryHistoryBatch(
        finalProgress,
        maximumRepositoryHistorySequence,
        1,
      ),
    ).toThrow("batch sequence is exhausted");
  });
});
