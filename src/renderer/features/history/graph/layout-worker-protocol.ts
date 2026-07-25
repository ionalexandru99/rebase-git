import type { GraphLayout } from './layout'
import type { GraphTopology } from './topology'

// The worker keeps the layout it last produced, so a request only carries the rows from
// `topology.firstRow` on. Everything crossing the boundary is an Int32Array and gets transferred,
// never cloned.
export interface GraphLayoutRequest {
  generation: number
  topology: GraphTopology
}

export interface GraphLayoutReady {
  status: 'ready'
  generation: number
  layout: GraphLayout
}

// The worker was restarted (or never saw the earlier rows) and cannot extend what it does not hold.
export interface GraphLayoutNeedsFullTopology {
  status: 'needs-full-topology'
  generation: number
}

export type GraphLayoutResponse = GraphLayoutReady | GraphLayoutNeedsFullTopology

export function topologyTransferables(topology: GraphTopology): Transferable[] {
  return [topology.parentOffsets.buffer, topology.parentIds.buffer] as Transferable[]
}

export function layoutTransferables(layout: GraphLayout): Transferable[] {
  return [
    layout.commitLane.buffer,
    layout.railLanes.buffer,
    layout.checkpointOffsets.buffer,
    layout.checkpointLanes.buffer
  ] as Transferable[]
}

// Compacts every buffer to exactly what it holds, so nothing beyond the layout crosses the wire and
// the worker keeps its own copy intact after the transfer detaches these.
export function detachLayout(layout: GraphLayout): GraphLayout {
  return {
    commitCount: layout.commitCount,
    maxLanes: layout.maxLanes,
    commitLane: layout.commitLane.slice(),
    railLanes: layout.railLanes.slice(),
    checkpointOffsets: layout.checkpointOffsets.slice(),
    checkpointLanes: layout.checkpointLanes.slice()
  }
}
