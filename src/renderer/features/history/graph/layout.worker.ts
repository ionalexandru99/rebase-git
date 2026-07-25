import { type GraphLayout, layoutGraph } from './layout'
import {
  detachLayout,
  type GraphLayoutRequest,
  type GraphLayoutResponse,
  layoutTransferables
} from './layout-worker-protocol'

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<GraphLayoutRequest>) => void) | null
  postMessage: (response: GraphLayoutResponse, transfer?: Transferable[]) => void
}

let held: GraphLayout | null = null

worker.onmessage = (event: MessageEvent<GraphLayoutRequest>) => {
  const { generation, topology } = event.data
  const firstRow = topology.firstRow

  if (firstRow > 0 && (!held || held.commitCount < firstRow)) {
    worker.postMessage({ status: 'needs-full-topology', generation })
    return
  }

  const layout = layoutGraph(
    topology,
    held && firstRow > 0 ? { layout: held, rows: firstRow } : undefined
  )
  held = layout

  const detached = detachLayout(layout)
  worker.postMessage(
    { status: 'ready', generation, layout: detached },
    layoutTransferables(detached)
  )
}
