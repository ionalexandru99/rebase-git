import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  alignRowsToCheckpoint,
  emptyGraphLayout,
  type GraphLayout,
  layoutGraph
} from '@/features/history/graph/layout'
import {
  type GraphLayoutRequest,
  type GraphLayoutResponse,
  topologyTransferables
} from '@/features/history/graph/layout-worker-protocol'
import {
  buildGraphTopology,
  type GraphTopology,
  sharedTopologyRows,
  sliceTopology
} from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'

export interface UseGraphLayoutOptions {
  commits: GitLogEntry[]
  enabled: boolean
  rowOf?: (hash: string) => number | undefined
  isHiddenParent?: (hash: string) => boolean
}

export interface GraphLayoutHandle {
  layout: GraphLayout
  topology: GraphTopology
  validRows: number
  pending: boolean
}

const EMPTY_TOPOLOGY: GraphTopology = {
  firstRow: 0,
  commitCount: 0,
  parentOffsets: new Int32Array(1),
  parentIds: new Int32Array(0)
}

function emptyHandle(): GraphLayoutHandle {
  return { layout: emptyGraphLayout(), topology: EMPTY_TOPOLOGY, validRows: 0, pending: false }
}

export function useGraphLayout(options: UseGraphLayoutOptions): GraphLayoutHandle {
  const [handle, setHandle] = useState<GraphLayoutHandle>(emptyHandle)
  const handleRef = useRef(handle)
  handleRef.current = handle

  const workerRef = useRef<Worker | null>(null)
  const workerRows = useRef(0)
  const generation = useRef(0)
  const requestedTopology = useRef<GraphTopology>(EMPTY_TOPOLOGY)

  const applyLayout = useCallback((layout: GraphLayout, topology: GraphTopology) => {
    setHandle({ layout, topology, validRows: layout.commitCount, pending: false })
  }, [])

  const layoutInline = useCallback(
    (topology: GraphTopology, carriedRows: number) => {
      const previous = handleRef.current
      applyLayout(
        layoutGraph(topology, {
          layout: previous.layout,
          rows: alignRowsToCheckpoint(carriedRows)
        }),
        topology
      )
    },
    [applyLayout]
  )

  const dropWorker = useCallback(() => {
    const worker = workerRef.current
    if (!worker) {
      return
    }
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    workerRef.current = null
    workerRows.current = 0
  }, [])

  const postRequest = useCallback((worker: Worker, topology: GraphTopology, firstRow: number) => {
    const request: GraphLayoutRequest = {
      generation: ++generation.current,
      topology: sliceTopology(topology, alignRowsToCheckpoint(firstRow))
    }
    workerRows.current = topology.commitCount
    worker.postMessage(request, topologyTransferables(request.topology))
  }, [])

  const ensureWorker = useCallback((): Worker | null => {
    if (workerRef.current) {
      return workerRef.current
    }
    if (typeof Worker === 'undefined') {
      return null
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('../graph/layout.worker.ts', import.meta.url), {
        type: 'module'
      })
    } catch {
      return null
    }
    workerRef.current = worker
    workerRows.current = 0

    worker.onmessage = (event: MessageEvent<GraphLayoutResponse>) => {
      const response = event.data
      if (response.generation !== generation.current) {
        return
      }
      if (response.status === 'needs-full-topology') {
        postRequest(worker, requestedTopology.current, 0)
        return
      }
      applyLayout(response.layout, requestedTopology.current)
    }

    worker.onerror = (event) => {
      event.preventDefault()
      if (workerRef.current !== worker) {
        return
      }
      dropWorker()
      generation.current += 1
      const topology = requestedTopology.current
      layoutInline(topology, sharedTopologyRows(handleRef.current.topology, topology))
    }

    return worker
  }, [applyLayout, dropWorker, layoutInline, postRequest])

  useLayoutEffect(() => {
    return () => {
      generation.current += 1
      dropWorker()
    }
  }, [dropWorker])

  const { commits, enabled, rowOf, isHiddenParent } = options

  useLayoutEffect(() => {
    const previous = handleRef.current
    if (!enabled || commits.length === 0) {
      requestedTopology.current = EMPTY_TOPOLOGY
      if (previous.layout.commitCount > 0 || previous.pending) {
        generation.current += 1
        setHandle(emptyHandle())
      }
      return
    }

    const topology = buildGraphTopology(commits, { rowOf, isHiddenParent })

    const inFlight = requestedTopology.current
    const sharedWithInFlight = sharedTopologyRows(inFlight, topology)
    if (
      sharedWithInFlight === topology.commitCount &&
      sharedWithInFlight === inFlight.commitCount
    ) {
      return
    }

    const carriedRows = sharedTopologyRows(previous.topology, topology)
    requestedTopology.current = topology

    const worker = ensureWorker()
    if (!worker) {
      generation.current += 1
      layoutInline(topology, carriedRows)
      return
    }

    setHandle({
      layout: previous.layout,
      topology,
      validRows: Math.min(carriedRows, previous.layout.commitCount),
      pending: true
    })
    postRequest(worker, topology, Math.min(sharedWithInFlight, workerRows.current))
  }, [commits, enabled, rowOf, isHiddenParent, ensureWorker, layoutInline, postRequest])

  return handle
}
