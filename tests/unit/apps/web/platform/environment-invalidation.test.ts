import { describe, expect, it } from "vite-plus/test";
import { invalidatedByChange } from "#web/platform/query/environment-invalidation";

const refs = { changes: "refs", repositoryId: "one" } as const;
const index = { changes: "index", repositoryId: "one" } as const;

describe("environment change invalidation", () => {
  it("refreshes ref and index queries of the changed repositories on ref changes", () => {
    expect(invalidatedByChange(refs, ["one"], "Refs")).toBe(true);
    expect(invalidatedByChange(index, ["one"], "Refs")).toBe(true);
    expect(invalidatedByChange(refs, ["two"], "Refs")).toBe(false);
  });

  it("refreshes only index queries on index changes", () => {
    expect(invalidatedByChange(index, ["one"], "Index")).toBe(true);
    expect(invalidatedByChange(refs, ["one"], "Index")).toBe(false);
  });

  it("treats a change without repositories or kind as a change to everything it watches", () => {
    expect(invalidatedByChange(refs)).toBe(true);
    expect(invalidatedByChange({ changes: "refs", repositoryId: null })).toBe(
      true,
    );
    expect(invalidatedByChange({ changes: "none", repositoryId: "one" })).toBe(
      false,
    );
    expect(invalidatedByChange(undefined)).toBe(false);
  });
});
