import { describe, expect, it } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import {
  graphColors,
  graphLaneColor,
  graphLaneSeeds,
} from "#web/features/commit-graph/layout/graph-colors";

describe("graph branch colors", () => {
  it.each([
    { name: "feature/cache", type: "branch" as const },
    { name: "upstream/feature/cache", type: "remote-branch" as const },
  ])("does not let unselected $name recolor another branch", (incidental) => {
    const roots = [
      { name: "main", oid: "main", type: "branch" as const },
      {
        name: "origin/feature/cache",
        oid: "feature",
        type: "remote-branch" as const,
      },
    ];
    const refs = [...roots, { ...incidental, oid: "older" }];
    const plan = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "main", parents: ["older"] },
        { oid: "feature", parents: [] },
        { oid: "older", parents: [] },
      ],
      graphLaneSeeds(refs, [], roots),
    );
    expect(graphColors(plan.rows, refs).nodes.get("older")).toBe("#4C9AFF");
  });

  it("keeps known local ancestry vivid when its only named ref is remote", () => {
    const first = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: "local", parents: ["older"] },
    ]);
    const refs = [
      { name: "origin/main", oid: "local", type: "remote-branch" as const },
    ];
    const seeds = graphLaneSeeds(refs, first.rows);
    expect(seeds.get("local")?.remote).toBe(false);
  });

  it("keeps the filter color when its tip leaves the loaded pages", () => {
    const refs = [{ name: "dev", oid: "tip", type: "branch" as const }];
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [{ oid: "tip", parents: ["older"] }],
      new Map([["tip", { color: 3, remote: false }]]),
    );
    const second = appendCommitLanes(first.checkpoint, [
      { oid: "older", parents: [] },
    ]);
    const before = graphColors(first.rows, refs);
    const after = graphColors(second.rows, refs, before.refs);
    expect(before.refs.get("dev")).toBe("#F97316");
    expect(after.refs.get("dev")).toBe(before.refs.get("dev"));
    expect(after.refs.get("dev")).toBe(after.nodes.get("older"));
  });

  it("keeps the destination's first-parent lane regardless of its name or side-branch visit order", () => {
    const seeds = graphLaneSeeds([
      { name: "feature/customer-ledger", oid: "tip", type: "branch" },
    ]);
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "tip", parents: ["dev-parent", "merged"] },
        { oid: "merged", parents: ["shared"] },
      ],
      seeds,
    );
    const second = appendCommitLanes(
      first.checkpoint,
      [
        { oid: "dev-parent", parents: ["shared"] },
        { oid: "shared", parents: ["base"] },
        { oid: "base", parents: [] },
      ],
      seeds,
    );
    expect(first.rows.map((row) => row.nodeLaneId)).toEqual([0, 1]);
    expect(second.rows.map((row) => row.nodeLaneId)).toEqual([0, 0, 0]);
    expect(second.rows[1]?.lanesAfter).toMatchObject([
      { id: 0, slot: 0, color: first.checkpoint.lanes[0]?.color },
    ]);
    expect(first.checkpoint.lanes.map((lane) => lane.id)).toEqual([0, 1]);
  });

  it("keeps remote history subdued until it reaches local history across pages", () => {
    const seeds = graphLaneSeeds([
      { name: "origin/dev", oid: "remote", type: "remote-branch" },
      { name: "dev", oid: "local", type: "branch" },
    ]);
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [{ oid: "remote", parents: ["middle"] }],
      seeds,
    );
    const second = appendCommitLanes(
      first.checkpoint,
      [
        { oid: "middle", parents: ["local"] },
        { oid: "local", parents: ["base"] },
        { oid: "base", parents: [] },
      ],
      seeds,
    );

    expect(first.rows[0]?.nodeRemote).toBe(true);
    expect(second.rows.map((row) => row.nodeRemote)).toEqual([
      true,
      false,
      false,
    ]);
    expect(second.rows[1]?.lanesBefore[0]?.remote).toBe(true);
    expect(second.rows[1]?.lanesAfter[0]?.remote).toBe(false);
    expect(first.checkpoint.lanes[0]?.remote).toBe(true);
    expect(
      new Set([...first.rows, ...second.rows].map((row) => row.nodeLaneId))
        .size,
    ).toBe(1);
  });

  it("makes shared ancestry vivid when diverged local and remote branches join", () => {
    const refs = [
      { name: "origin/main", oid: "remote", type: "remote-branch" as const },
      { name: "main", oid: "local", type: "branch" as const },
    ];
    const plan = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "remote", parents: ["shared"] },
        { oid: "local", parents: ["shared"] },
        { oid: "shared", parents: ["base"] },
        { oid: "base", parents: [] },
      ],
      graphLaneSeeds(refs),
    );
    expect(plan.rows.map((row) => row.nodeRemote)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(plan.rows[0]?.lanesAfter[0]?.remote).toBe(true);
    expect(plan.rows[2]?.lanesAfter[0]?.remote).toBe(false);
  });

  it("prefers vivid local tips when refs share a commit regardless of ref order", () => {
    const refs = [
      { name: "dev", oid: "shared", type: "branch" as const },
      { name: "origin/dev", oid: "shared", type: "remote-branch" as const },
    ];
    expect(graphLaneSeeds(refs).get("shared")).toEqual({
      color: 0,
      remote: false,
    });
    expect(graphLaneSeeds(refs.toReversed())).toEqual(graphLaneSeeds(refs));
  });

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
      graphLaneSeeds(refs),
    );
    const second = appendCommitLanes(first.checkpoint, [
      { oid: "c", parents: ["e"] },
      { oid: "d", parents: ["e"] },
    ]);
    const initialColors = graphColors(first.rows, refs);
    const olderColors = graphColors(second.rows, refs);
    expect(initialColors.nodes.get("a")).toBe(initialColors.nodes.get("b"));
    expect(initialColors.refs.get("main")).toBe(initialColors.nodes.get("a"));
    expect(initialColors.refs.get("origin/main")).toBe(
      initialColors.nodes.get("b"),
    );
    expect([...olderColors.nodes.values()]).toEqual([
      ...initialColors.nodes.values(),
    ]);
    expect(initialColors.refs.get("main")).toBe(graphLaneColor(0));
  });

  it("keeps a continuous rail stable when an older named root shares it", () => {
    const refs = [
      { name: "main", oid: "a", type: "branch" as const },
      { name: "feature/cache", oid: "b", type: "branch" as const },
    ];
    const seeds = graphLaneSeeds(refs);
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [{ oid: "a", parents: ["b"] }],
      seeds,
    );
    const second = appendCommitLanes(
      first.checkpoint,
      [{ oid: "b", parents: ["c"] }],
      seeds,
    );
    const before = graphColors(first.rows, refs);
    const after = graphColors([...first.rows, ...second.rows], refs);

    expect(after.nodes.get("a")).toEqual(before.nodes.get("a"));
    expect(after.refs.get("feature/cache")).toBe(after.nodes.get("b"));
    expect(after.refs.get("main")).toBe(after.nodes.get("b"));
  });
});
