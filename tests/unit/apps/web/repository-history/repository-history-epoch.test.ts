import { describe, expect, it } from "vite-plus/test";
import { RepositoryHistoryEpoch } from "#web/features/repository-history/reader/repository-history-epoch";

describe("repository history epoch", () => {
  it("rejects stale results after a request is superseded", () => {
    const epoch = new RepositoryHistoryEpoch();

    expect(epoch.begin("first")).toBeUndefined();
    expect(epoch.begin("second")).toBe("first");
    expect(epoch.finish("first")).toBe(false);
    expect(epoch.finish("second")).toBe(true);
    expect(epoch.cancel()).toBeUndefined();
  });
});
