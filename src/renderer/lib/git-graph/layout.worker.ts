import { layoutCommits } from './layout'
import type { GraphLayoutWorkerRequest, GraphLayoutWorkerResponse } from './layout-worker-protocol'

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<GraphLayoutWorkerRequest>) => void) | null
  postMessage: (response: GraphLayoutWorkerResponse) => void
}

worker.onmessage = (event: MessageEvent<GraphLayoutWorkerRequest>) => {
  const hiddenParents = new Set(event.data.hiddenParents)
  const response: GraphLayoutWorkerResponse = {
    generation: event.data.generation,
    layout: layoutCommits(event.data.commits, undefined, {
      isHiddenParent: (hash) => hiddenParents.has(hash)
    })
  }
  worker.postMessage(response)
}
