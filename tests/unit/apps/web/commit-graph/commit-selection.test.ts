import { describe, expect, it } from "vitest";
import { emptyCommitGraphSelection } from "#web/features/commit-graph/commit-selection.contract";
import {
  clearGraphSelection,
  moveGraphSelection,
  reconcileGraphSelection,
  selectGraphCommit,
} from "#web/features/commit-graph/selection/commit-selection";

const rows = ["a", "b", "c", "d", "e"];

describe("commit graph selection", () => {
  it("orders toggled commits by visible row order", () => {
    const last = selectGraphCommit(
      emptyCommitGraphSelection,
      rows,
      "d",
      "replace",
    );
    const toggled = selectGraphCommit(last, rows, "b", "toggle");
    expect(toggled).toEqual({
      selectedOids: ["b", "d"],
      activeOid: "b",
      anchorOid: "b",
      activeIndex: 1,
    });
    expect(
      selectGraphCommit(toggled, rows, "b", "toggle").selectedOids,
    ).toEqual(["d"]);
  });

  it("extends and shrinks a range from a stable anchor in either direction", () => {
    const middle = selectGraphCommit(
      emptyCommitGraphSelection,
      rows,
      "c",
      "replace",
    );
    const older = selectGraphCommit(middle, rows, "e", "range");
    expect(older.selectedOids).toEqual(["c", "d", "e"]);
    const newer = selectGraphCommit(older, rows, "a", "range");
    expect(newer.selectedOids).toEqual(["a", "b", "c"]);
    expect(newer.anchorOid).toBe("c");
  });

  it("moves the active row independently from selection and anchor", () => {
    const selected = selectGraphCommit(
      emptyCommitGraphSelection,
      rows,
      "b",
      "replace",
    );
    const moved = moveGraphSelection(selected, rows, 2, "activate");
    expect(moved).toEqual({
      selectedOids: ["b"],
      activeOid: "d",
      anchorOid: "b",
      activeIndex: 3,
    });
  });

  it("preserves visible selections after collapse and chooses the surviving row at the active position", () => {
    const selected = selectGraphCommit(
      selectGraphCommit(emptyCommitGraphSelection, rows, "b", "replace"),
      rows,
      "d",
      "range",
    );
    expect(reconcileGraphSelection(selected, ["a", "b", "e"])).toEqual({
      selectedOids: ["b"],
      activeOid: "e",
      anchorOid: "b",
      activeIndex: 2,
    });
    expect(
      reconcileGraphSelection(selected, ["a", "b", "e", "f", "g"]).activeOid,
    ).toBe("f");
  });

  it("retains selected OIDs when rows reorder or append", () => {
    const selection = selectGraphCommit(
      selectGraphCommit(emptyCommitGraphSelection, rows, "b", "replace"),
      rows,
      "d",
      "toggle",
    );
    expect(
      reconcileGraphSelection(selection, ["d", "c", "b", "a", "e", "f"]),
    ).toEqual({
      selectedOids: ["d", "b"],
      activeOid: "d",
      anchorOid: "d",
      activeIndex: 0,
    });
  });

  it("clears selection while retaining the active row", () => {
    const selection = selectGraphCommit(
      emptyCommitGraphSelection,
      rows,
      "c",
      "replace",
    );
    expect(clearGraphSelection(selection)).toEqual({
      ...selection,
      selectedOids: [],
    });
  });

  it("ignores hidden pointer targets and clamps keyboard movement", () => {
    expect(
      selectGraphCommit(emptyCommitGraphSelection, rows, "hidden", "replace"),
    ).toBe(emptyCommitGraphSelection);
    const first = moveGraphSelection(emptyCommitGraphSelection, rows, -100);
    expect(first.activeOid).toBe("a");
    expect(moveGraphSelection(first, rows, 100).activeOid).toBe("e");
    expect(reconcileGraphSelection(first, [])).toEqual(
      emptyCommitGraphSelection,
    );
  });
});
