import { describe, expect, it } from "vite-plus/test";
import { describeRepositoryHistoryError } from "#web/features/commit-graph/components/commit-graph-messages";
import {
  RepositoryHistoryOffline,
  RepositoryHistoryStorageUnavailable,
} from "#web/features/repository-history/repository-history-reader";

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
