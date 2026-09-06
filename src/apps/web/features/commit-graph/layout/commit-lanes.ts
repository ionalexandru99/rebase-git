import type {
  CommitLane,
  CommitLaneCheckpoint,
  CommitLaneRow,
  CommitLaneSeed,
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
  seeds: ReadonlyMap<string, CommitLaneSeed> = new Map(),
) {
  const lanes = checkpoint.lanes.map((lane) => ({ ...lane }));
  let nextLaneId = checkpoint.nextLaneId;
  const rows: CommitLaneRow[] = [];

  for (const commit of commits) {
    let nodeIndex = lanes.findIndex((lane) => lane.expectedOid === commit.oid);
    const nodeHasIncomingLane = nodeIndex >= 0;
    if (nodeIndex < 0) {
      lanes.push(
        lane(
          nextLaneId,
          commit.oid,
          availableSlot(lanes),
          seeds.get(commit.oid),
        ),
      );
      nodeIndex = lanes.length - 1;
      nextLaneId += 1;
    }
    let nodeLane = lanes[nodeIndex];
    if (nodeLane === undefined) {
      throw new Error("Missing commit lane");
    }
    const lanesBefore = [...lanes];
    if (seeds.get(commit.oid)?.remote === false && nodeLane.remote) {
      nodeLane = { ...nodeLane, remote: false };
      lanes[nodeIndex] = nodeLane;
    }
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
        if (nodeLane.branchDepth < target.branchDepth) {
          parentLaneIds.push(nodeLane.id);
          lanes[nodeIndex] = {
            ...nodeLane,
            expectedOid: firstParent,
            remote: nodeLane.remote && target.remote,
          };
          lanes.splice(existingFirst, 1);
        } else {
          parentLaneIds.push(target.id);
          if (!nodeLane.remote && target.remote)
            lanes[existingFirst] = { ...target, remote: false };
          lanes.splice(nodeIndex, 1);
        }
      } else {
        lanes[nodeIndex] = { ...nodeLane, expectedOid: firstParent };
        parentLaneIds.push(nodeLane.id);
      }

      colorParentLane(lanes, firstParent, seeds.get(firstParent));

      let insertIndex = Math.min(nodeIndex + 1, lanes.length);
      for (const parent of otherParents) {
        const existing = lanes.find(
          (current) => current.expectedOid === parent,
        );
        if (existing !== undefined) {
          parentLaneIds.push(existing.id);
          if (!nodeLane.remote && existing.remote)
            lanes[lanes.indexOf(existing)] = { ...existing, remote: false };
          continue;
        }
        const created = lane(
          nextLaneId,
          parent,
          availableSlot(lanes),
          {
            color: seeds.get(parent)?.color ?? nextLaneId % 8,
            remote: nodeLane.remote,
          },
          nodeLane.branchDepth + 1,
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
      nodeHasIncomingLane,
      nodeRemote: nodeLane.remote,
      oid: commit.oid,
      parentLaneIds,
    });
  }
  return {
    checkpoint: { lanes, nextLaneId } satisfies CommitLaneCheckpoint,
    rows,
  };
}

function colorParentLane(
  lanes: CommitLane[],
  oid: string,
  seed: CommitLaneSeed | undefined,
) {
  if (!seed?.boundary) return;
  const index = lanes.findIndex((current) => current.expectedOid === oid);
  const parent = lanes[index];
  if (parent !== undefined && parent.color !== seed.color)
    lanes[index] = { ...parent, color: seed.color };
}

function lane(
  id: number,
  expectedOid: string,
  slot: number,
  seed: CommitLaneSeed = { color: id % 8, remote: false },
  branchDepth = 0,
): CommitLane {
  return {
    color: seed.color,
    remote: seed.remote,
    expectedOid,
    id,
    slot,
    branchDepth,
  };
}

function availableSlot(lanes: readonly CommitLane[]) {
  const occupied = new Set(lanes.map((lane) => lane.slot));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return slot;
}
