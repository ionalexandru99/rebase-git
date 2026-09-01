import { describe, expect, it } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/commit-lanes";

const a = "a".repeat(40);
const b = "b".repeat(40);
const c = "c".repeat(40);
const d = "d".repeat(40);
const e = "e".repeat(40);

describe("commit lanes", () => {
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
