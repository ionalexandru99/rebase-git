import { GRAPH_LAYOUT_DEBOUNCE_MS } from '@shared/graph-config'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { matchesCommitPrefix } from '@/lib/git-graph/commit-sequence'
import { getLayoutRow, type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
import type {
  GraphLayoutWorkerRequest,
  GraphLayoutWorkerResponse
} from '@/lib/git-graph/layout-worker-protocol'
import type { GitLogEntry } from '@/types'

function isTailAppend(previous: GitLogEntry[] | undefined, next: GitLogEntry[]): boolean {
  if (!previous || previous.length === 0 || next.length < previous.length) {
    return false
  }
  return (
    previous[0]?.hash === next[0]?.hash &&
    previous[previous.length - 1]?.hash === next[previous.length - 1]?.hash
  )
}

interface UseGraphLayoutOptions {
  commits: GitLogEntry[]
  loading: boolean
  enabled: boolean
  debounceMs?: number
  isHiddenParent?: (hash: string) => boolean
}

interface GraphLayoutState {
  layout: LayoutResult | null
  layoutPending: boolean
  laidOutThroughIndex: number
}

function createEmptyState(): GraphLayoutState {
  return {
    layout: null,
    layoutPending: false,
    laidOutThroughIndex: 0
  }
}

function sameLayoutPrefix(commits: GitLogEntry[], layout: LayoutResult | null): boolean {
  return (
    !!layout && layout.rowCount > 0 && commits[0]?.hash === getLayoutRow(layout, 0)?.commit.hash
  )
}

function hiddenParentSet(
  commits: GitLogEntry[],
  isHiddenParent: ((hash: string) => boolean) | undefined
): Set<string> {
  const hidden = new Set<string>()
  if (!isHiddenParent) {
    return hidden
  }
  for (const commit of commits) {
    for (const parent of commit.parents) {
      if (isHiddenParent(parent)) {
        hidden.add(parent)
      }
    }
  }
  return hidden
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

function createLayoutWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null
  }
  try {
    return new Worker(new URL('../lib/git-graph/layout.worker.ts', import.meta.url), {
      type: 'module'
    })
  } catch {
    return null
  }
}

export function useGraphLayout(options: UseGraphLayoutOptions) {
  const debounceMs = options.debounceMs ?? GRAPH_LAYOUT_DEBOUNCE_MS
  const [state, setReactState] = useState<GraphLayoutState>(createEmptyState)
  const stateRef = useRef(state)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutedCommits = useRef<GitLogEntry[] | null>(null)
  const layoutedHiddenParents = useRef<ReadonlySet<string>>(new Set())
  const layoutedHiddenPredicate = useRef(options.isHiddenParent)
  const isHiddenParentRef = useRef(options.isHiddenParent)
  const layoutGeneration = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const pendingWorkerLayout = useRef<GraphLayoutWorkerRequest | null>(null)
  const mounted = useRef(false)
  const installWorkerRef = useRef<() => Worker | null>(() => null)
  isHiddenParentRef.current = options.isHiddenParent
  stateRef.current = state

  const setState = useCallback(
    (update: GraphLayoutState | ((current: GraphLayoutState) => GraphLayoutState)) => {
      const next = typeof update === 'function' ? update(stateRef.current) : update
      if (next === stateRef.current) {
        return
      }
      stateRef.current = next
      setReactState(next)
    },
    []
  )

  const handleWorkerFailure = useCallback(
    (failedWorker: Worker) => {
      if (workerRef.current !== failedWorker) {
        return
      }
      failedWorker.onmessage = null
      failedWorker.onerror = null
      failedWorker.terminate()
      workerRef.current = null

      const pending = pendingWorkerLayout.current
      pendingWorkerLayout.current = null
      if (pending && pending.generation === layoutGeneration.current) {
        const hiddenParents = new Set(pending.hiddenParents)
        const result = layoutCommits(pending.commits, undefined, {
          isHiddenParent: (hash) => hiddenParents.has(hash)
        })
        setState({
          layout: result,
          layoutPending: false,
          laidOutThroughIndex: result.laidOutThroughIndex
        })
      } else if (stateRef.current.layoutPending) {
        setState((current) => ({ ...current, layoutPending: false }))
      }

      if (mounted.current) {
        installWorkerRef.current()
      }
    },
    [setState]
  )

  const installWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current
    }
    const worker = createLayoutWorker()
    if (!worker) {
      return null
    }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<GraphLayoutWorkerResponse>) => {
      if (event.data.generation !== layoutGeneration.current) {
        return
      }
      pendingWorkerLayout.current = null
      const result = event.data.layout
      setState({
        layout: result,
        layoutPending: false,
        laidOutThroughIndex: result.laidOutThroughIndex
      })
    }
    worker.onerror = (event) => {
      event.preventDefault()
      handleWorkerFailure(worker)
    }
    return worker
  }, [handleWorkerFailure, setState])
  installWorkerRef.current = installWorker

  useLayoutEffect(() => {
    mounted.current = true
    installWorker()
    return () => {
      mounted.current = false
      pendingWorkerLayout.current = null
      const worker = workerRef.current
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        workerRef.current = null
      }
      layoutedCommits.current = null
    }
  }, [installWorker])

  const runLayout = useCallback(
    (commits: GitLogEntry[]) => {
      const snapshot = stateRef.current
      const previousCommits = snapshot.layout?.commits ?? []
      const sameSequence =
        previousCommits.length === commits.length && matchesCommitPrefix(previousCommits, commits)
      const hiddenParents = hiddenParentSet(commits, isHiddenParentRef.current)
      const hiddenParentsChanged = !sameSet(hiddenParents, layoutedHiddenParents.current)

      layoutedCommits.current = commits
      layoutedHiddenParents.current = hiddenParents
      layoutedHiddenPredicate.current = isHiddenParentRef.current
      if (sameSequence && !hiddenParentsChanged && snapshot.layout) {
        layoutGeneration.current += 1
        pendingWorkerLayout.current = null
        if (snapshot.layoutPending) {
          setState((current) => ({ ...current, layoutPending: false }))
        }
        return
      }

      const extendable =
        !snapshot.layoutPending &&
        !hiddenParentsChanged &&
        sameLayoutPrefix(commits, snapshot.layout) &&
        commits.length > previousCommits.length &&
        matchesCommitPrefix(previousCommits, commits)
      const generation = ++layoutGeneration.current
      const worker = workerRef.current ?? installWorker()

      if (extendable || !worker) {
        pendingWorkerLayout.current = null
        const result = layoutCommits(
          commits,
          extendable ? (snapshot.layout ?? undefined) : undefined,
          { isHiddenParent: (hash) => hiddenParents.has(hash) }
        )
        setState({
          layout: result,
          layoutPending: false,
          laidOutThroughIndex: result.laidOutThroughIndex
        })
        return
      }

      const request: GraphLayoutWorkerRequest = {
        generation,
        commits,
        hiddenParents: [...hiddenParents]
      }
      setState((current) => ({ ...current, layoutPending: true, laidOutThroughIndex: 0 }))
      pendingWorkerLayout.current = request
      try {
        worker.postMessage(request)
      } catch {
        handleWorkerFailure(worker)
      }
    },
    [handleWorkerFailure, installWorker, setState]
  )

  const scheduleLayout = useCallback(
    (commits: GitLogEntry[], immediate: boolean) => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }

      if (commits.length === 0) {
        layoutGeneration.current += 1
        pendingWorkerLayout.current = null
        layoutedCommits.current = commits
        layoutedHiddenParents.current = new Set()
        layoutedHiddenPredicate.current = isHiddenParentRef.current
        const current = stateRef.current
        if (current.layout !== null || current.layoutPending || current.laidOutThroughIndex !== 0) {
          setState(createEmptyState())
        }
        return
      }

      if (immediate) {
        runLayout(commits)
        return
      }

      setState((current) => (current.layoutPending ? current : { ...current, layoutPending: true }))
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null
        runLayout(commits)
      }, debounceMs)
    },
    [debounceMs, runLayout, setState]
  )

  useLayoutEffect(() => {
    if (!options.enabled) {
      scheduleLayout([], true)
      return
    }
    const commits = options.commits
    if (
      layoutedCommits.current === commits &&
      layoutedHiddenPredicate.current === options.isHiddenParent &&
      debounceTimer.current === null
    ) {
      return
    }
    const layout = stateRef.current.layout
    const needsInitialLayout = commits.length > 0 && layout === null
    const immediate =
      !options.loading || needsInitialLayout || !isTailAppend(layout?.commits, commits)
    scheduleLayout(commits, immediate)
  }, [options.commits, options.enabled, options.loading, options.isHiddenParent, scheduleLayout])

  useEffect(() => {
    return () => {
      layoutGeneration.current += 1
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [])

  return {
    layout: state.layout,
    layoutPending: state.layoutPending,
    laidOutThroughIndex: state.laidOutThroughIndex
  }
}
