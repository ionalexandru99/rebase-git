import { advanceLanes, createLaneState, ensureLaneCapacity, type LaneState } from './lanes'
import { CHECKPOINT_ROWS, type GraphLayout, loadCheckpoint } from './layout'
import type { GraphTopology } from './topology'

// Replays lane boundaries from the nearest checkpoint. `lanes` is the state entering `row`;
// `incoming` keeps the state of the row just stepped over, so a caller drawing row r has both sides
// of it at once. One walker is reused across frames — seeking never allocates.
export interface LaneWalker extends LaneState {
  row: number
  incoming: Int32Array
  incomingCount: number
}

export function createLaneWalker(): LaneWalker {
  const state = createLaneState()
  return { ...state, row: 0, incoming: new Int32Array(state.lanes.length), incomingCount: 0 }
}

export function seekLanes(
  walker: LaneWalker,
  layout: GraphLayout,
  topology: GraphTopology,
  row: number
): void {
  const target = Math.max(0, Math.min(row, layout.commitCount))
  const checkpoint = Math.floor(target / CHECKPOINT_ROWS)
  loadCheckpoint(walker, layout, checkpoint)
  walker.row = checkpoint * CHECKPOINT_ROWS
  walker.incomingCount = 0

  while (walker.row < target) {
    stepLanes(walker, topology)
  }
}

export function stepLanes(walker: LaneWalker, topology: GraphTopology): void {
  if (walker.incoming.length < walker.laneCount) {
    walker.incoming = new Int32Array(walker.lanes.length)
  }
  walker.incoming.set(walker.lanes.subarray(0, walker.laneCount))
  walker.incomingCount = walker.laneCount

  advanceLanes(walker, topology, walker.row)
  walker.row++
  ensureLaneCapacity(walker, walker.laneCount)
}
