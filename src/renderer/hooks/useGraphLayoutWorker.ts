import { GRAPH_LAYOUT_DEBOUNCE_MS } from '@shared/graph-config'
import { useRef } from 'react'
import { type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
import { type Accessor, createEffect, createSignal, onCleanup, untrack } from '@/lib/react-compat'
import type { GitLogEntry } from '@/types'

interface UseGraphLayoutWorkerOptions {
  commits: Accessor<GitLogEntry[]>
  loading: Accessor<boolean>
  enabled: Accessor<boolean>
  debounceMs?: number
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
  if (!layout || layout.rows.length === 0) {
    return false
  }
  return commits[0]?.hash === layout.rows[0]?.commit.hash
}

export function useGraphLayoutWorker(options: UseGraphLayoutWorkerOptions) {
  const debounceMs = options.debounceMs ?? GRAPH_LAYOUT_DEBOUNCE_MS

  const [state, setState] = createSignal<GraphLayoutState>(createEmptyState())
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutedCommits = useRef<GitLogEntry[] | null>(null)

  const runLayout = (commits: GitLogEntry[]) => {
    const snapshot = untrack(() => state())
    const prevCommits = snapshot.layout?.commits ?? []
    const sameSequence =
      prevCommits.length === commits.length &&
      commits.every((commit, index) => commit.hash === prevCommits[index]?.hash)

    layoutedCommits.current = commits
    if (sameSequence && snapshot.layout) {
      if (snapshot.layoutPending) {
        setState((current) => ({ ...current, layoutPending: false }))
      }
      return
    }

    const extendable =
      sameLayoutPrefix(commits, snapshot.layout) &&
      commits.length > prevCommits.length &&
      prevCommits.every((commit, index) => commit.hash === commits[index]?.hash)

    const result = layoutCommits(commits, extendable ? (snapshot.layout ?? undefined) : undefined)
    setState({
      layout: result,
      layoutPending: false,
      laidOutThroughIndex: result.laidOutThroughIndex
    })
  }

  const scheduleLayout = (commits: GitLogEntry[], immediate: boolean) => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }

    if (commits.length === 0) {
      layoutedCommits.current = commits
      if (untrack(() => state()).layout !== null) {
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
  }

  createEffect(() => {
    if (!options.enabled()) {
      return
    }
    const commits = options.commits()
    if (layoutedCommits.current === commits && debounceTimer.current === null) {
      return
    }
    const loading = options.loading()
    const needsInitialLayout = commits.length > 0 && untrack(() => state()).layout === null
    scheduleLayout(commits, !loading || needsInitialLayout)
  })

  onCleanup(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current)
    }
  })

  return {
    layout: () => state().layout,
    layoutPending: () => state().layoutPending,
    laidOutThroughIndex: () => state().laidOutThroughIndex
  }
}

export function buildDisplayRows(
  commits: GitLogEntry[],
  layout: LayoutResult | null,
  laidOutThroughIndex: number
) {
  if (!layout) {
    return commits.map((commit) => ({
      commit,
      commitLane: 0,
      incoming: [] as (string | null)[],
      outgoing: [] as (string | null)[]
    }))
  }

  const rows = []
  for (let index = 0; index < commits.length; index++) {
    if (index < laidOutThroughIndex && layout.rows[index]) {
      rows.push(layout.rows[index])
      continue
    }
    rows.push({
      commit: commits[index],
      commitLane: 0,
      incoming: [] as (string | null)[],
      outgoing: [] as (string | null)[]
    })
  }
  return rows
}
