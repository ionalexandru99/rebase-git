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
  localHistory?: ReadonlySet<string>,
) {
  const lanes = checkpoint.lanes.map((lane) => ({ ...lane }));
  let nextLaneId = checkpoint.nextLaneId;
  const rows: CommitLaneRow[] = [];

  for (const commit of commits) {
    let nodeIndex = arrivingLaneIndex(lanes, commit.oid);
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
    const seed = seeds.get(commit.oid);
    if (seed?.boundary && seed.color !== nodeLane.color) {
      nodeLane = {
        ...nodeLane,
        incomingColor: nodeLane.color,
        color: seed.color,
      };
      lanes[nodeIndex] = nodeLane;
    }
    const lanesBefore = [...lanes];
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
      const incoming = lanes[index];
      if (incoming?.expectedOid === commit.oid && incoming.id !== nodeLane.id)
        lanes.splice(index, 1);
    }
    const nodeLaneId = nodeLane.id;
    nodeIndex = lanes.findIndex((lane) => lane.id === nodeLaneId);
    if (nodeLane.incomingColor !== undefined) {
      const { incomingColor: _incomingColor, ...continuation } = nodeLane;
      nodeLane = continuation;
      lanes[nodeIndex] = nodeLane;
    }
    const remote =
      localHistory === undefined
        ? !lanesBefore.some(
            (lane) => lane.expectedOid === commit.oid && !lane.remote,
          ) && seeds.get(commit.oid)?.remote !== false
        : !localHistory.has(commit.oid);
    if (remote !== nodeLane.remote) {
      nodeLane = { ...nodeLane, remote };
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
      lanes[nodeIndex] = { ...nodeLane, expectedOid: firstParent };
      parentLaneIds.push(nodeLane.id);

      let insertIndex = Math.min(nodeIndex + 1, lanes.length);
      for (const parent of otherParents) {
        const existing = lanes.find(
          (current) => current.expectedOid === parent,
        );
        const created = lane(
          nextLaneId,
          parent,
          availableSlot(lanes),
          {
            color:
              existing?.color ?? seeds.get(parent)?.color ?? nextLaneId % 8,
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

function arrivingLaneIndex(lanes: readonly CommitLane[], oid: string) {
  let selected = -1;
  for (const [index, lane] of lanes.entries()) {
    if (lane.expectedOid !== oid) continue;
    const current = lanes[selected];
    if (
      current === undefined ||
      lane.branchDepth < current.branchDepth ||
      (lane.branchDepth === current.branchDepth && lane.id < current.id)
    )
      selected = index;
  }
  return selected;
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
