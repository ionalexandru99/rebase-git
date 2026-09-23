import { describe, expect, it } from "vitest";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model";
import { selectedDiffLines } from "#web/features/working-changes/diff/diff-selection";

describe("diff selection coordinates", () => {
  const { metadata: diff } = createChangeDiffModel({
    kind: "text",
    revision: "fixture",
    path: "file.ts",
    patch:
      "--- file.ts\n+++ file.ts\n@@ -5,3 +5,3 @@\n context\n-old\n+new\n last\n",
    before: "1\n2\n3\n4\ncontext\nold\nlast\n",
    after: "1\n2\n3\n4\ncontext\nnew\nlast\n",
  });
  it("maps hunks and selections to source line numbers beyond collapsed context", () => {
    if (!diff?.hunks[0]) throw new Error("Missing fixture hunk");
    expect(
      selectedDiffLines(diff, { side: "deletions", start: 5, end: 7 }),
    ).toEqual(["-6"]);
    expect(
      selectedDiffLines(diff, {
        side: "deletions",
        start: 6,
        endSide: "additions",
        end: 6,
      }),
    ).toEqual(["-6", "+6"]);
  });
});
