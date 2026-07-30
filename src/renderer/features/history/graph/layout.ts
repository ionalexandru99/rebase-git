import { advanceLanes, createLaneState, ensureLaneCapacity, type LaneState } from './lanes'
import type { GraphTopology } from './topology'

export interface GraphLayout {
  commitCount: number
  commitLane: Int32Array
  railLanes: Int32Array
  maxLanes: number
  checkpointOffsets: Int32Array
  checkpointLanes: Int32Array
}

export const CHECKPOINT_ROWS = 128

export interface GraphLayoutReuse {
  layout: GraphLayout
  rows: number
}

export function alignRowsToCheckpoint(rows: number): number {
  return Math.max(0, Math.floor(rows / CHECKPOINT_ROWS) * CHECKPOINT_ROWS)
}

export function checkpointCount(commitCount: number): number {
  return Math.floor(commitCount / CHECKPOINT_ROWS) + 1
}

export function emptyGraphLayout(): GraphLayout {
  return {
    commitCount: 0,
    commitLane: new Int32Array(0),
    railLanes: new Int32Array(0),
    maxLanes: 0,
    checkpointOffsets: new Int32Array(checkpointCount(0) + 1),
    checkpointLanes: new Int32Array(0)
  }
}

export function layoutGraph(topology: GraphTopology, reuse?: GraphLayoutReuse): GraphLayout {
  const commitCount = topology.commitCount
  if (commitCount === 0) {
    return emptyGraphLayout()
  }

  const carriedRows =
    topology.firstRow > 0
      ? topology.firstRow
      : alignRowsToCheckpoint(
          reuse ? Math.min(reuse.rows, reuse.layout.commitCount, commitCount) : 0
        )
  if (carriedRows > 0 && (carriedRows % CHECKPOINT_ROWS !== 0 || !reuse)) {
    throw new Error(`graph layout cannot resume at row ${carriedRows}`)
  }

  const builder = createLayoutBuilder(commitCount, carriedRows > 0 ? reuse?.layout : undefined)
  if (carriedRows > 0 && reuse) {
    carryPrefix(builder, reuse.layout, carriedRows)
  }

  for (let row = carriedRows; row < commitCount; row++) {
    if (row % CHECKPOINT_ROWS === 0) {
      writeCheckpoint(builder, row)
    }
    const incomingLanes = builder.state.laneCount
    advanceLanes(builder.state, topology, row)

    builder.commitLane[row] = builder.state.commitLane
    const railLanes = Math.max(builder.state.commitLane + 1, incomingLanes, builder.state.laneCount)
    builder.railLanes[row] = railLanes
    builder.maxLanes = Math.max(builder.maxLanes, railLanes)
  }

  return {
    commitCount,
    commitLane: builder.commitLane,
    railLanes: builder.railLanes,
    maxLanes: builder.maxLanes,
    checkpointOffsets: builder.checkpointOffsets.subarray(0, checkpointCount(commitCount) + 1),
    checkpointLanes: builder.checkpointLanes.subarray(0, builder.checkpointLaneCount)
  }
}

interface LayoutBuilder {
  commitLane: Int32Array
  railLanes: Int32Array
  checkpointOffsets: Int32Array
  checkpointLanes: Int32Array
  checkpointLaneCount: number
  state: LaneState
  maxLanes: number
}

function createLayoutBuilder(
  commitCount: number,
  previous: GraphLayout | undefined
): LayoutBuilder {
  const checkpoints = checkpointCount(commitCount)
  return {
    commitLane: new Int32Array(commitCount),
    railLanes: new Int32Array(commitCount),
    checkpointOffsets: new Int32Array(checkpoints + 1),
    checkpointLanes: new Int32Array(
      Math.max(checkpoints * INITIAL_LANES_PER_CHECKPOINT, previous?.checkpointLanes.length ?? 0)
    ),
    checkpointLaneCount: 0,
    state: createLaneState(),
    maxLanes: 0
  }
}

const INITIAL_LANES_PER_CHECKPOINT = 8

function carryPrefix(builder: LayoutBuilder, previous: GraphLayout, carriedRows: number): void {
  const checkpoints = carriedRows / CHECKPOINT_ROWS
  const carriedLanes = previous.checkpointOffsets[checkpoints]

  builder.commitLane.set(previous.commitLane.subarray(0, carriedRows))
  builder.railLanes.set(previous.railLanes.subarray(0, carriedRows))
  builder.checkpointOffsets.set(previous.checkpointOffsets.subarray(0, checkpoints + 1))
  growCheckpointLanes(builder, carriedLanes)
  builder.checkpointLanes.set(previous.checkpointLanes.subarray(0, carriedLanes))
  builder.checkpointLaneCount = carriedLanes

  loadCheckpoint(builder.state, previous, checkpoints)
  for (let row = 0; row < carriedRows; row++) {
    builder.maxLanes = Math.max(builder.maxLanes, builder.railLanes[row])
  }
}

function writeCheckpoint(builder: LayoutBuilder, row: number): void {
  const checkpoint = row / CHECKPOINT_ROWS
  const start = builder.checkpointLaneCount
  builder.checkpointOffsets[checkpoint] = start
  growCheckpointLanes(builder, start + builder.state.laneCount)
  builder.checkpointLanes.set(builder.state.lanes.subarray(0, builder.state.laneCount), start)
  builder.checkpointLaneCount = start + builder.state.laneCount
  builder.checkpointOffsets[checkpoint + 1] = builder.checkpointLaneCount
}

function growCheckpointLanes(builder: LayoutBuilder, required: number): void {
  if (required <= builder.checkpointLanes.length) {
    return
  }
  const grown = new Int32Array(Math.max(required, builder.checkpointLanes.length * 2))
  grown.set(builder.checkpointLanes.subarray(0, builder.checkpointLaneCount))
  builder.checkpointLanes = grown
}

export function loadCheckpoint(state: LaneState, layout: GraphLayout, checkpoint: number): void {
  const start = layout.checkpointOffsets[checkpoint]
  const laneCount = Math.max(0, layout.checkpointOffsets[checkpoint + 1] - start)
  ensureLaneCapacity(state, laneCount)
  state.lanes.set(layout.checkpointLanes.subarray(start, start + laneCount))
  state.laneCount = laneCount
}
