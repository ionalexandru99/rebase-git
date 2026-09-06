import { describe, expect, it } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const d = "d".repeat(40);
const e = "e".repeat(40);

describe("commit lanes", () => {
  it("keeps converging lanes separate until their shared parent commit", () => {
    const first = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: "merge", parents: ["main", "side"] },
      { oid: "main", parents: ["base"] },
      { oid: "side", parents: ["base"] },
    ]);
    expect(first.checkpoint.lanes.map((lane) => lane.expectedOid)).toEqual([
      "base",
      "base",
    ]);
    expect(first.rows[2]?.parentLaneIds).toEqual([first.rows[2]?.nodeLaneId]);
    const joined = appendCommitLanes(first.checkpoint, [
      { oid: "base", parents: [] },
    ]);
    expect(joined.rows[0]?.lanesBefore).toHaveLength(2);
    expect(joined.rows[0]?.nodeLaneId).toBe(0);
    expect(joined.checkpoint.lanes).toEqual([]);
  });
  it("preserves first-parent continuations through nested merges", () => {
    const first = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: "tip", parents: ["destination", "side"] },
      { oid: "side", parents: ["side-parent", "nested"] },
      { oid: "nested", parents: ["side-base"] },
    ]);
    const second = appendCommitLanes(first.checkpoint, [
      { oid: "side-parent", parents: ["side-base"] },
      { oid: "destination", parents: ["base"] },
      { oid: "side-base", parents: ["base"] },
      { oid: "base", parents: [] },
    ]);

    expect(first.rows.map((row) => row.nodeLaneId)).toEqual([0, 1, 2]);
    expect(second.rows.map((row) => row.nodeLaneId)).toEqual([1, 0, 1, 0]);
    expect(second.rows[0]?.lanesAfter.map((lane) => lane.slot)).toEqual([
      0, 1, 2,
    ]);
    expect(second.rows[2]?.lanesAfter.map((lane) => lane.slot)).toEqual([0, 1]);
  });

  it("reuses vacant slots across successive merges without widening the graph", () => {
    const { rows } = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: "a", parents: ["b", "c"] },
      { oid: "b", parents: [] },
      { oid: "c", parents: ["d", "e"] },
      { oid: "d", parents: [] },
      { oid: "e", parents: ["f", "g"] },
    ]);
    expect(
      Math.max(
        ...rows.flatMap((row) => row.lanesAfter.map((lane) => lane.slot)),
      ),
    ).toBe(1);
  });
  it("keeps surviving rails in their slots when a neighboring branch ends", () => {
    const result = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: a, parents: [b, c, d] },
      { oid: b, parents: [] },
      { oid: c, parents: [e] },
    ]);

    expect(result.rows[1]?.lanesAfter.map((lane) => lane.slot)).toEqual([1, 2]);
    expect(result.rows[2]?.lanesBefore.map((lane) => lane.slot)).toEqual([
      1, 2,
    ]);
    expect(result.checkpoint.lanes.map((lane) => lane.slot)).toEqual([1, 2]);
  });

  it("keeps prior row plans unchanged when older commits append", () => {
    const first = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: a, parents: [b, c] },
      { oid: b, parents: [d] },
    ]);
    const priorRows = structuredClone(first.rows);
    const second = appendCommitLanes(first.checkpoint, [
      { oid: c, parents: [d] },
      { oid: d, parents: [] },
    ]);

    expect(first.rows).toEqual(priorRows);
    expect([...first.rows, ...second.rows]).toEqual(
      appendCommitLanes(createCommitLaneCheckpoint(), [
        { oid: a, parents: [b, c] },
        { oid: b, parents: [d] },
        { oid: c, parents: [d] },
        { oid: d, parents: [] },
      ]).rows,
    );
  });

  it("serializes checkpoints across octopus merges", () => {
    const result = appendCommitLanes(createCommitLaneCheckpoint(), [
      { oid: a, parents: [b, c, d] },
      { oid: b, parents: [e] },
    ]);
    const restored = JSON.parse(JSON.stringify(result.checkpoint));

    expect(
      appendCommitLanes(restored, [{ oid: c, parents: [e] }]).rows[0],
    ).toMatchObject({ nodeLaneId: 1, oid: c });
    expect(new Set(result.checkpoint.lanes.map((lane) => lane.id)).size).toBe(
      result.checkpoint.lanes.length,
    );
  });
});
