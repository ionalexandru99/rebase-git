import { describe, expect, it } from "vite-plus/test";
import {
  hunkLines,
  hunkRange,
  selectedDiffLines,
} from "#web/features/working-changes/components/change-diff-viewer.tsx";

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
  it("selects every changed line of a hunk and no context", () => {
    const hunk = {
      hunkContent: [
        {
          type: "change" as const,
          deletions: 1,
          deletionLineIndex: 1,
          additions: 1,
          additionLineIndex: 1,
        },
        {
          type: "context" as const,
          lines: 3,
          deletionLineIndex: 2,
          additionLineIndex: 2,
        },
        {
          type: "change" as const,
          deletions: 0,
          deletionLineIndex: 5,
          additions: 2,
          additionLineIndex: 5,
        },
      ],
    };
    expect(hunkRange(hunk)).toEqual({
      start: 2,
      side: "deletions",
      end: 7,
      endSide: "additions",
    });
    expect(hunkLines(hunk)).toEqual(["-2", "+2", "+6", "+7"]);
  });
  it("selects the changed lines between two deletion-only ends of a hunk", () => {
    const hunk = {
      hunkContent: [
        {
          type: "change" as const,
          deletions: 1,
          deletionLineIndex: 0,
          additions: 0,
          additionLineIndex: 0,
        },
        {
          type: "context" as const,
          lines: 1,
          deletionLineIndex: 1,
          additionLineIndex: 0,
        },
        {
          type: "change" as const,
          deletions: 1,
          deletionLineIndex: 2,
          additions: 1,
          additionLineIndex: 1,
        },
        {
          type: "context" as const,
          lines: 1,
          deletionLineIndex: 3,
          additionLineIndex: 2,
        },
        {
          type: "change" as const,
          deletions: 1,
          deletionLineIndex: 4,
          additions: 0,
          additionLineIndex: 3,
        },
      ],
    };
    expect(hunkLines(hunk)).toEqual(["-1", "-3", "+2", "-5"]);
  });
});
