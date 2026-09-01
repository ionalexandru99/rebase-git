export interface CommitTopology {
  readonly oid: string;
  readonly parents: readonly string[];
}

export interface CommitLane {
  readonly color: number;
  readonly expectedOid: string;
  readonly id: number;
}

export interface CommitLaneCheckpoint {
  readonly lanes: readonly CommitLane[];
  readonly nextLaneId: number;
}

export interface CommitLaneRow {
  readonly lanesAfter: readonly number[];
  readonly lanesBefore: readonly number[];
  readonly nodeLaneId: number;
  readonly oid: string;
  readonly parentLaneIds: readonly number[];
}

export function createCommitLaneCheckpoint(): CommitLaneCheckpoint {
  return { lanes: [], nextLaneId: 0 };
}

export function appendCommitLanes(
  checkpoint: CommitLaneCheckpoint,
  commits: readonly CommitTopology[],
) {
  const lanes = checkpoint.lanes.map((lane) => ({ ...lane }));
  let nextLaneId = checkpoint.nextLaneId;
  const rows: CommitLaneRow[] = [];

  for (const commit of commits) {
    let nodeIndex = lanes.findIndex((lane) => lane.expectedOid === commit.oid);
    if (nodeIndex < 0) {
      lanes.push(lane(nextLaneId, commit.oid));
      nodeIndex = lanes.length - 1;
      nextLaneId += 1;
    }
    const nodeLane = lanes[nodeIndex];
    if (nodeLane === undefined) throw new Error("Missing commit lane");
    const lanesBefore = lanes.map((current) => current.id);
    const parentLaneIds: number[] = [];

    if (commit.parents.length === 0) {
      lanes.splice(nodeIndex, 1);
    } else {
      const [firstParent, ...otherParents] = commit.parents;
      if (firstParent === undefined) throw new Error("Missing first parent");
      const existingFirst = lanes.findIndex(
        (current, index) =>
          index !== nodeIndex && current.expectedOid === firstParent,
      );
      if (existingFirst >= 0) {
        const target = lanes[existingFirst];
        if (target === undefined) throw new Error("Missing parent lane");
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
        const created = lane(nextLaneId, parent);
        nextLaneId += 1;
        lanes.splice(insertIndex, 0, created);
        insertIndex += 1;
        parentLaneIds.push(created.id);
      }
    }

    rows.push({
      lanesAfter: lanes.map((current) => current.id),
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

function lane(id: number, expectedOid: string): CommitLane {
  return { color: id % 8, expectedOid, id };
}
