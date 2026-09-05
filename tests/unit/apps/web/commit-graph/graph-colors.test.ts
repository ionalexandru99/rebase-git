import { describe, expect, it } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import {
  graphBranchColorIndex,
  graphColors,
  graphLaneColor,
} from "#web/features/commit-graph/layout/graph-colors";

describe("graph branch colors", () => {
  it("keeps local and remote tips on separate lanes the same color across page checkpoints", () => {
    const refs = [
      { name: "main", oid: "a", type: "branch" as const },
      { name: "origin/main", oid: "b", type: "remote-branch" as const },
    ];
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "a", parents: ["c"] },
        { oid: "b", parents: ["d"] },
      ],
      new Map([
        ["a", graphBranchColorIndex("main")],
        ["b", graphBranchColorIndex("main")],
      ]),
    );
    const second = appendCommitLanes(first.checkpoint, [
      { oid: "c", parents: ["e"] },
      { oid: "d", parents: ["e"] },
    ]);
    const initialColors = graphColors(first.rows, refs);
    const olderColors = graphColors(second.rows, refs);
    expect(initialColors.lanes.get(0)).toBe(initialColors.lanes.get(1));
    expect(initialColors.refs.get("main")).toBe(initialColors.lanes.get(0));
    expect(olderColors.lanes).toEqual(initialColors.lanes);
    expect(initialColors.refs.get("main")).toBe(graphLaneColor(0));
  });
});
