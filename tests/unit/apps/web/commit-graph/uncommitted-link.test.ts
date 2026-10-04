import { describe, expect, it } from "vite-plus/test";
import { uncommittedLink } from "#web/features/commit-graph/components/uncommitted-changes-row.tsx";
import { graphLaneX } from "#web/features/commit-graph/layout/graph-geometry.ts";
import {
  appendCommitLanes,
  type CommitTopology,
  createCommitLaneCheckpoint,
} from "#web/features/repository-history/commit-lanes.ts";

function lanes(commits: readonly CommitTopology[]) {
  return appendCommitLanes(createCommitLaneCheckpoint(), commits).rows;
}

describe("uncommitted changes link", () => {
  it("joins HEAD when it is the newest row", () => {
    const rows = lanes([
      { oid: "head", parents: ["base"] },
      { oid: "base", parents: [] },
    ]);

    expect(uncommittedLink(rows, 0, "head")).toMatchObject({
      index: 0,
      x: graphLaneX(0),
    });
  });

  it("runs down an empty lane past newer commits", () => {
    const rows = lanes([
      { oid: "newer", parents: ["base"] },
      { oid: "head", parents: ["base"] },
      { oid: "base", parents: [] },
    ]);

    expect(uncommittedLink(rows, 0, "head")).toMatchObject({
      index: 1,
      x: graphLaneX(1),
    });
  });

  it.each([
    {
      name: "a newer commit continues HEAD's lane",
      commits: [
        { oid: "ahead", parents: ["head"] },
        { oid: "head", parents: [] },
      ],
      start: 0,
    },
    {
      name: "HEAD is not in the history",
      commits: [{ oid: "other", parents: [] }],
      start: 0,
    },
    {
      name: "the rows above HEAD are not loaded",
      commits: [{ oid: "head", parents: [] }],
      start: 40,
    },
  ])("leaves the node unlinked when $name", ({ commits, start }) => {
    expect(uncommittedLink(lanes(commits), start, "head")).toBeUndefined();
  });
});
