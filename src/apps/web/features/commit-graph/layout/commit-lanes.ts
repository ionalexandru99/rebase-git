import type {
  CommitLane,
  CommitLaneCheckpoint,
  CommitLaneRow,
  CommitTopology,
} from "#web/features/commit-graph/layout/commit-lanes.contract";

export type {
  CommitLane,
  CommitLaneCheckpoint,
  CommitLaneRow,
  CommitTopology,
} from "#web/features/commit-graph/layout/commit-lanes.contract";

export function createCommitLaneCheckpoint(): CommitLaneCheckpoint {
  return { lanes: [], nextLaneId: 0 };
}

export function appendCommitLanes(
  checkpoint: CommitLaneCheckpoint,
  commits: readonly CommitTopology[],
  colors: ReadonlyMap<string, number> = new Map(),
) {
  const lanes = checkpoint.lanes.map((lane) => ({ ...lane }));
  let nextLaneId = checkpoint.nextLaneId;
  const rows: CommitLaneRow[] = [];

  for (const commit of commits) {
    let nodeIndex = lanes.findIndex((lane) => lane.expectedOid === commit.oid);
    if (nodeIndex < 0) {
      lanes.push(
        lane(
          nextLaneId,
          commit.oid,
          availableSlot(lanes),
          colors.get(commit.oid),
        ),
      );
      nodeIndex = lanes.length - 1;
      nextLaneId += 1;
    }
    const nodeLane = lanes[nodeIndex];
    if (nodeLane === undefined) {
      throw new Error("Missing commit lane");
    }
    const lanesBefore = [...lanes];
    const parentLaneIds: number[] = [];

    if (commit.parents.length === 0) {
      lanes.splice(nodeIndex, 1);
    } else {
      const [firstParent, ...otherParents] = commit.parents;
      if (firstParent === undefined) {
        throw new Error("Missing first parent");
      }
      const existingFirst = lanes.findIndex(
        (current, index) =>
          index !== nodeIndex && current.expectedOid === firstParent,
      );
      if (existingFirst >= 0) {
        const target = lanes[existingFirst];
        if (target === undefined) {
          throw new Error("Missing parent lane");
        }
        parentLaneIds.push(target.id);
        lanes.splice(nodeIndex, 1);
      } else {
        lanes[nodeIndex] = { ...nodeLane, expectedOid: firstParent };
        parentLaneIds.push(nodeLane.id);
      }

      let insertIndex = Math.min(nodeIndex + 1, lanes.length);
      for (const parent of otherParents) {
        const existing = lanes.find(
          (current) => current.expectedOid === parent,
        );
        if (existing !== undefined) {
          parentLaneIds.push(existing.id);
          continue;
        }
        const created = lane(
          nextLaneId,
          parent,
          availableSlot(lanes),
          colors.get(parent),
        );
        nextLaneId += 1;
        lanes.splice(insertIndex, 0, created);
        insertIndex += 1;
        parentLaneIds.push(created.id);
      }
    }

    rows.push({
      lanesAfter: [...lanes],
      lanesBefore,
      nodeLaneId: nodeLane.id,
      oid: commit.oid,
      parentLaneIds,
    });
  }
  return {
    checkpoint: { lanes, nextLaneId } satisfies CommitLaneCheckpoint,
    rows,
  };
}

function lane(
  id: number,
  expectedOid: string,
  slot: number,
  color = id % 8,
): CommitLane {
  return { color, expectedOid, id, slot };
}

function availableSlot(lanes: readonly CommitLane[]) {
  const occupied = new Set(lanes.map((lane) => lane.slot));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return slot;
}
