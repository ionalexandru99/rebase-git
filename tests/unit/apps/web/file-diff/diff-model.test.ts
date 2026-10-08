import { describe, expect, it } from "vite-plus/test";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model.ts";

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

it("renders a partial diff from its patch and offers the whole file", () => {
  const { metadata, hasHiddenContext } = createChangeDiffModel({
    kind: "partial",
    path: "file.txt",
    revision: "revision",
    before: null,
    after: null,
    patch: "--- file.txt\n+++ file.txt\n@@ -3 +3 @@\n-old\n+new\n",
  });
  expect(metadata?.hunks).toHaveLength(1);
  expect(hasHiddenContext).toBe(true);
});
