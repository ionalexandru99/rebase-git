import { describe, expect, it } from "vite-plus/test";
import { changeDiff } from "#tests-support/fixtures.ts";
import {
  contentUnchanged,
  createChangeDiffModel,
} from "#web/features/file-diff/diff-model.ts";

function model(before: string | null, after: string | null, patch: string) {
  return createChangeDiffModel(
    changeDiff("file.txt", {
      kind: "text",
      before,
      after,
      patch: `--- file.txt\n+++ file.txt\n${patch}`,
    }),
  );
}

function partial(patch: string, beforeBytes = 200_000) {
  return changeDiff("file.txt", {
    kind: "partial",
    beforeBytes,
    afterBytes: 200_000,
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

describe("partial diffs", () => {
  it("renders the patch alone and offers the rest of a changed file", () => {
    const { metadata, hasHiddenContext } = createChangeDiffModel(
      partial("@@ -3 +3 @@\n-old\n+new\n"),
    );
    expect(metadata?.hunks).toHaveLength(1);
    expect(hasHiddenContext).toBe(true);
  });

  it("offers nothing more for a new file", () => {
    expect(
      createChangeDiffModel(partial("@@ -0,0 +1 @@\n+new\n", 0))
        .hasHiddenContext,
    ).toBe(false);
  });

  it("reports unchanged content when the patch has no changes", () => {
    expect(contentUnchanged(partial(""))).toBe(true);
    expect(contentUnchanged(partial("@@ -3 +3 @@\n-old\n+new\n"))).toBe(false);
  });
});
