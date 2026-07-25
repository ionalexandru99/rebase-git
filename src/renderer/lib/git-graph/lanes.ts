import { EMPTY_LANE, type GraphTopology } from './topology'

// The lane state between two rows: `lanes[lane]` holds the id of the commit that lane is waiting
// for, or EMPTY_LANE. One row of the graph is one `advanceLanes` call, shared by the layout pass and
// by the on-demand replay the canvas uses, so the two can never disagree.
export interface LaneState {
  lanes: Int32Array
  laneCount: number
  commitLane: number
}

const INITIAL_LANE_CAPACITY = 16

export function createLaneState(): LaneState {
  return { lanes: new Int32Array(INITIAL_LANE_CAPACITY), laneCount: 0, commitLane: 0 }
}

export function advanceLanes(state: LaneState, topology: GraphTopology, row: number): void {
  let commitLane = indexOfOwner(state.lanes, state.laneCount, row)
  if (commitLane === -1) {
    commitLane = firstFreeLane(state.lanes, state.laneCount)
    if (commitLane === -1) {
      commitLane = state.laneCount
      openLane(state, EMPTY_LANE)
    }
  } else {
    state.lanes[commitLane] = EMPTY_LANE
  }

  const slot = row - topology.firstRow
  const parentStart = topology.parentOffsets[slot]
  const parentEnd = topology.parentOffsets[slot + 1]
  for (let offset = parentStart; offset < parentEnd; offset++) {
    const parent = topology.parentIds[offset]
    if (indexOfOwner(state.lanes, state.laneCount, parent) !== -1) {
      continue
    }
    if (offset === parentStart && state.lanes[commitLane] === EMPTY_LANE) {
      state.lanes[commitLane] = parent
      continue
    }
    const free = firstFreeLane(state.lanes, state.laneCount)
    if (free === -1) {
      openLane(state, parent)
    } else {
      state.lanes[free] = parent
    }
  }

  while (state.laneCount > 0 && state.lanes[state.laneCount - 1] === EMPTY_LANE) {
    state.laneCount--
  }
  state.commitLane = commitLane
}

export function indexOfOwner(lanes: Int32Array, laneCount: number, owner: number): number {
  for (let lane = 0; lane < laneCount; lane++) {
    if (lanes[lane] === owner) {
      return lane
    }
  }
  return -1
}

export function ensureLaneCapacity(state: LaneState, capacity: number): void {
  if (state.lanes.length >= capacity) {
    return
  }
  let grown = state.lanes.length
  while (grown < capacity) {
    grown *= 2
  }
  const lanes = new Int32Array(grown)
  lanes.set(state.lanes)
  state.lanes = lanes
}

function firstFreeLane(lanes: Int32Array, laneCount: number): number {
  for (let lane = 0; lane < laneCount; lane++) {
    if (lanes[lane] === EMPTY_LANE) {
      return lane
    }
  }
  return -1
}

function openLane(state: LaneState, owner: number): void {
  ensureLaneCapacity(state, state.laneCount + 1)
  state.lanes[state.laneCount++] = owner
}
