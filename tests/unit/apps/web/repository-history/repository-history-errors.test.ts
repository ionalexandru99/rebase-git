import { describe, expect, it } from "vitest";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/commit-graph-messages";
import {
  RepositoryHistoryOffline,
  RepositoryHistoryStorageUnavailable,
} from "#web/features/repository-history/repository-history-reader.contract";

describe("repository history errors", () => {
  it("keeps offline and storage failures distinct", () => {
    expect(describeRepositoryHistoryError(new RepositoryHistoryOffline())).toBe(
      "Commit history is unavailable while the Environment reconnects.",
    );
    expect(
      describeRepositoryHistoryError(new RepositoryHistoryStorageUnavailable()),
    ).toBe("This browser cannot store repository history.");
  });
});
