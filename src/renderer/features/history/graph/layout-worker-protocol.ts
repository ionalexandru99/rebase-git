import type { GraphLayout } from './layout'
import type { GraphTopology } from './topology'

export interface GraphLayoutRequest {
  generation: number
  topology: GraphTopology
}

export interface GraphLayoutReady {
  status: 'ready'
  generation: number
  layout: GraphLayout
}

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
