import { describe, expect, it } from "vite-plus/test";
import { selectedDiffLines } from "#web/features/working-changes/diff/diff-selection";

describe("diff selection coordinates", () => {
  const diff = {
    hunks: [
      {
        hunkContent: [
          {
            type: "context" as const,
            lines: 1,
            deletionLineIndex: 4,
            additionLineIndex: 4,
          },
          {
            type: "change" as const,
            deletions: 1,
            deletionLineIndex: 5,
            additions: 1,
            additionLineIndex: 5,
          },
          {
            type: "context" as const,
            lines: 1,
            deletionLineIndex: 6,
            additionLineIndex: 6,
          },
        ],
      },
    ],
  };
  it("maps hunks and selections to source line numbers beyond collapsed context", () => {
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
