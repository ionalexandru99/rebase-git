import { describe, expect, it } from "vitest";
import { createChangeDiffModel } from "#web/features/file-diff/api";

function model(before: string | null, after: string | null, patch: string) {
  return createChangeDiffModel({
    kind: "text",
    path: "file.txt",
    revision: "revision",
    before,
    after,
    patch: `--- file.txt\n+++ file.txt\n${patch}`,
  });
}

describe("unchanged line visibility", () => {
  it("offers expansion for hidden lines before and after a change", () => {
    expect(
      model("one\ntwo\nold\n", "one\ntwo\nnew\n", "@@ -3 +3 @@\n-old\n+new\n")
        .hasHiddenContext,
    ).toBe(true);
    expect(
      model("old\none\ntwo\n", "new\none\ntwo\n", "@@ -1 +1 @@\n-old\n+new\n")
        .hasHiddenContext,
    ).toBe(true);
  });

  it("does not offer expansion when the viewer already shows every line", () => {
    expect(
      model(null, "one\ntwo\n", "@@ -0,0 +1,2 @@\n+one\n+two\n")
        .hasHiddenContext,
    ).toBe(false);
    expect(
      model("one\ntwo\n", null, "@@ -1,2 +0,0 @@\n-one\n-two\n")
        .hasHiddenContext,
    ).toBe(false);
    expect(
      model("old\nlast\n", "new\nlast\n", "@@ -1 +1 @@\n-old\n+new\n")
        .hasHiddenContext,
    ).toBe(false);
  });
});
