import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";

export const laneColorCount = 8;

export interface CommitTopology {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly farParents?: readonly string[];
  readonly farArrival?: { readonly parent: string; readonly child: string };
}

export interface FarEdgeEnd {
  readonly direction: "down" | "up";
  readonly from: string;
  readonly to: string;
}

export interface CommitLanePosition {
  readonly id: number;
  readonly slot: number;
  readonly color: number;
  readonly incomingColor?: number;
  readonly remote: boolean;
  readonly far?: FarEdgeEnd;
}

export interface CommitLaneSeed {
  readonly color: number;
  readonly remote: boolean;
  readonly boundary?: boolean;
}

export interface CommitLane extends CommitLanePosition {
  readonly expectedOid: string;
  readonly branchDepth: number;
}

interface FarEdgeLook {
  readonly parent: string;
  readonly color: number;
  readonly remote: boolean;
}

export interface CommitLaneCheckpoint {
  readonly lanes: readonly CommitLane[];
  readonly nextLaneId: number;
  readonly farEdges: readonly FarEdgeLook[];
}

export interface CommitLaneRow {
  readonly lanesAfter: readonly CommitLanePosition[];
  readonly lanesBefore: readonly CommitLanePosition[];
  readonly nodeLaneId: number;
  readonly nodeHasIncomingLane: boolean;
  readonly nodeRemote: boolean;
  readonly oid: string;
  readonly parentLaneIds: readonly number[];
}

export function graphRefName(ref: RepositoryHistoryRefTarget) {
  return ref.type === "remote-branch"
    ? ref.name.slice(ref.name.indexOf("/") + 1)
    : ref.name;
}

export function graphBranchColorIndex(name: string) {
  if (["main", "master", "dev", "develop"].includes(name)) return 0;
  let hash = 0;
  for (const character of name)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 1 + (hash % (laneColorCount - 1));
}

export function graphLaneSeeds(
  refs: readonly RepositoryHistoryRefTarget[],
  previousRows: readonly CommitLaneRow[] = [],
  roots: readonly RepositoryHistoryRefTarget[] = [],
) {
  const seeds = new Map<string, CommitLaneSeed>();
  for (const ref of refs) {
    if (ref.type !== "branch" && ref.type !== "remote-branch") continue;
    if (seeds.get(ref.oid)?.remote === false) continue;
    seeds.set(ref.oid, {
      color: graphBranchColorIndex(graphRefName(ref)),
      remote: ref.type === "remote-branch",
    });
  }
  for (const row of previousRows) {
    const node = row.lanesBefore.find((lane) => lane.id === row.nodeLaneId);
    if (node !== undefined)
      seeds.set(row.oid, {
        color: node.color,
        remote: seeds.get(row.oid)?.remote === false ? false : row.nodeRemote,
      });
  }
  const selectedRefs = new Set(roots.map((ref) => `${ref.type}\0${ref.name}`));
  for (const ref of refs) {
    if (ref.type !== "branch" && ref.type !== "remote-branch") continue;
    if (!selectedRefs.has(`${ref.type}\0${ref.name}`)) continue;
    const seed = seeds.get(ref.oid);
    if (seed?.boundary) continue;
    seeds.set(ref.oid, {
      color: graphBranchColorIndex(graphRefName(ref)),
      remote: seed?.remote ?? ref.type === "remote-branch",
      boundary: true,
    });
  }
  return seeds;
}

export function createCommitLaneCheckpoint(): CommitLaneCheckpoint {
  return { lanes: [], nextLaneId: 0, farEdges: [] };
}

export function appendCommitLanes(
  checkpoint: CommitLaneCheckpoint,
  commits: readonly CommitTopology[],
  seeds: ReadonlyMap<string, CommitLaneSeed> = new Map(),
  localHistory?: { readonly has: (oid: string) => boolean },
) {
  const lanes = checkpoint.lanes.map((lane) => ({ ...lane }));
  const farEdges = [...checkpoint.farEdges];
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
      if (
        (incoming?.expectedOid === commit.oid && incoming.id !== nodeLane.id) ||
        incoming?.far?.direction === "down"
      )
        lanes.splice(index, 1);
    }
    const nodeLaneId = nodeLane.id;
    nodeIndex = lanes.findIndex((lane) => lane.id === nodeLaneId);
    if (nodeLane.incomingColor !== undefined || nodeLane.far !== undefined) {
      const {
        incomingColor: _incomingColor,
        far: _far,
        ...continuation
      } = nodeLane;
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
      lanes[nodeIndex] = withFarEnd(
        { ...nodeLane, expectedOid: firstParent },
        commit,
        farEdges,
      );
      parentLaneIds.push(nodeLane.id);

      let insertIndex = Math.min(nodeIndex + 1, lanes.length);
      for (const parent of otherParents) {
        const existing = lanes.find(
          (current) => current.expectedOid === parent,
        );
        const far = commit.farParents?.includes(parent) === true;
        const created = lane(
          nextLaneId,
          parent,
          far
            ? nearestSlot(lanes, nodeLane.slot, lanesBefore)
            : availableSlot([
                ...lanes,
                ...lanesBefore.filter(
                  (ending) => ending.far?.direction === "down",
                ),
              ]),
          {
            color:
              existing?.color ?? seeds.get(parent)?.color ?? nextLaneId % 8,
            remote: nodeLane.remote,
          },
          nodeLane.branchDepth + 1,
        );
        nextLaneId += 1;
        lanes.splice(insertIndex, 0, withFarEnd(created, commit, farEdges));
        insertIndex += 1;
        parentLaneIds.push(created.id);
      }
    }

    if (commit.farArrival !== undefined) {
      const { parent, child } = commit.farArrival;
      const look = farEdges.findIndex((edge) => edge.parent === parent);
      const joined = lanes.find((current) => current.expectedOid === parent);
      const occupied = [...lanes, ...lanesBefore];
      lanes.push({
        ...lane(
          nextLaneId,
          parent,
          joined === undefined
            ? availableSlot(occupied)
            : nearestSlot(lanes, joined.slot, lanesBefore),
          farEdges[look] ?? seeds.get(parent),
          joined === undefined ? 0 : joined.branchDepth + 1,
        ),
        far: { direction: "up", from: parent, to: child },
      });
      nextLaneId += 1;
      if (look >= 0) farEdges.splice(look, 1);
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
    checkpoint: { lanes, nextLaneId, farEdges } satisfies CommitLaneCheckpoint,
    rows,
  };
}

function withFarEnd(
  current: CommitLane,
  commit: CommitTopology,
  farEdges: FarEdgeLook[],
): CommitLane {
  const parent = current.expectedOid;
  if (commit.farParents?.includes(parent) !== true) return current;
  const look = { parent, color: current.color, remote: current.remote };
  const index = farEdges.findIndex((edge) => edge.parent === parent);
  if (index < 0) farEdges.push(look);
  else farEdges[index] = look;
  return {
    ...current,
    far: { direction: "down", from: commit.oid, to: parent },
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

function nearestSlot(
  lanes: readonly CommitLanePosition[],
  origin: number,
  ending: readonly CommitLanePosition[],
) {
  const occupied = new Set([...lanes, ...ending].map((lane) => lane.slot));
  for (let distance = 1; ; distance += 1) {
    if (!occupied.has(origin + distance)) return origin + distance;
    if (origin - distance >= 0 && !occupied.has(origin - distance))
      return origin - distance;
  }
}

function availableSlot(lanes: readonly CommitLanePosition[]) {
  const occupied = new Set(lanes.map((lane) => lane.slot));
  let slot = 0;
  while (occupied.has(slot)) slot += 1;
  return slot;
}
