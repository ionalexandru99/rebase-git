import { describe, expect, it } from "vitest";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import { drawGraphTile } from "#web/features/commit-graph/layout/draw-graph-tile";
import { graphLaneSeeds } from "#web/features/commit-graph/layout/graph-colors";

describe("graph tile endpoints", () => {
  it("paints selected branch colors independently along one continuous lane", () => {
    const refs = [
      {
        name: "experimental/graph-scroll-a1",
        oid: "feature",
        type: "branch" as const,
      },
      { name: "origin/main", oid: "main", type: "remote-branch" as const },
    ];
    const seeds = graphLaneSeeds(refs, [], refs);
    const first = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "feature", parents: ["work"] },
        { oid: "work", parents: ["main"] },
      ],
      seeds,
    );
    const second = appendCommitLanes(
      first.checkpoint,
      [
        { oid: "main", parents: ["base"] },
        { oid: "base", parents: [] },
      ],
      seeds,
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing canvas context");
    drawGraphTile(canvas, [...first.rows, ...second.rows], 0, 64, 1);
    for (const y of [22, 44, 60])
      expect([...context.getImageData(16, y, 1, 1).data]).toEqual([
        249, 115, 22, 255,
      ]);
    expect([...context.getImageData(16, 74, 1, 1).data]).toEqual([
      76, 154, 255, 255,
    ]);
    const expected = context.getImageData(0, 52, 64, 52).data;
    drawGraphTile(canvas, second.rows, 0, 64, 1);
    expect(context.getImageData(0, 0, 64, 52).data).toEqual(expected);
  });

  it("keeps remote joins and merging curves at one opacity", () => {
    const refs = [
      { name: "origin/main", oid: "a", type: "remote-branch" as const },
      { name: "upstream/main", oid: "b", type: "remote-branch" as const },
    ];
    const plan = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "a", parents: ["c"] },
        { oid: "b", parents: ["c"] },
        { oid: "c", parents: ["d"] },
        { oid: "d", parents: [] },
      ],
      graphLaneSeeds(refs),
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing canvas context");
    drawGraphTile(canvas, plan.rows, 0, 64, 1);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alphas = pixels.filter((_, index) => index % 4 === 3);
    expect(Math.max(...alphas)).toBe(128);
    expect(context.getImageData(16, 26, 1, 1).data[3]).toBe(128);
  });

  it("paints remote rails softer than local rails without changing their hue", () => {
    const plan = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "remote", parents: ["local"] },
        { oid: "local", parents: ["base"] },
        { oid: "base", parents: [] },
      ],
      graphLaneSeeds([
        { name: "origin/main", oid: "remote", type: "remote-branch" },
        { name: "main", oid: "local", type: "branch" },
      ]),
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing canvas context");
    drawGraphTile(canvas, plan.rows, 0, 64, 1);
    const remote = context.getImageData(16, 22, 1, 1).data;
    const local = context.getImageData(16, 48, 1, 1).data;
    expect(remote[3]).toBe(128);
    expect(local[3]).toBe(255);
    for (const channel of [0, 1, 2])
      expect(
        Math.abs((remote[channel] ?? 0) - (local[channel] ?? 0)),
      ).toBeLessThanOrEqual(1);
    expect(context.getImageData(16, 13, 1, 1).data[3]).toBe(0);
  });

  it("starts new tips at their circles and preserves incoming rails across pages", () => {
    const first = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: "tip", parents: ["parent"] },
    ]);
    const second = appendCommitLanes(first.checkpoint, [
      { oid: "isolated", parents: [] },
      { oid: "parent", parents: [] },
    ]);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Missing canvas context");
    const alpha = (x: number, y: number) =>
      context.getImageData(x, y, 1, 1).data[3];

    drawGraphTile(canvas, first.rows, 0, 64, 1);
    expect(alpha(16, 2)).toBe(0);
    expect(alpha(19, 13)).toBeGreaterThan(0);
    expect(alpha(16, 22)).toBeGreaterThan(0);

    drawGraphTile(canvas, second.rows, 0, 64, 1);
    expect(alpha(16, 2)).toBeGreaterThan(0);
    expect(alpha(16, 24)).toBeGreaterThan(0);
    expect(alpha(32, 2)).toBe(0);
    expect(alpha(35, 13)).toBeGreaterThan(0);
    expect(alpha(32, 22)).toBe(0);
    expect(alpha(16, 28)).toBeGreaterThan(0);
    expect(alpha(19, 39)).toBeGreaterThan(0);
    expect(alpha(16, 48)).toBe(0);
  });
});
