import { GRAPH_LAYOUT_DEBOUNCE_MS } from '@shared/graph-config'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

interface UseGraphLayoutOptions {
  commits: GitLogEntry[]
  loading: boolean
  enabled: boolean
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

export function useGraphLayout(options: UseGraphLayoutOptions) {
  const debounceMs = options.debounceMs ?? GRAPH_LAYOUT_DEBOUNCE_MS

  const [state, setReactState] = useState<GraphLayoutState>(createEmptyState)
  const stateRef = useRef(state)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutedCommits = useRef<GitLogEntry[] | null>(null)
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

  const runLayout = useCallback(
    (commits: GitLogEntry[]) => {
      const snapshot = stateRef.current
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
    },
    [setState]
  )

  const scheduleLayout = useCallback(
    (commits: GitLogEntry[], immediate: boolean) => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }

      if (commits.length === 0) {
        layoutedCommits.current = commits
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

  useEffect(() => {
    if (!options.enabled) {
      return
    }
    const commits = options.commits
    if (layoutedCommits.current === commits && debounceTimer.current === null) {
      return
    }
    const loading = options.loading
    const needsInitialLayout = commits.length > 0 && stateRef.current.layout === null
    scheduleLayout(commits, !loading || needsInitialLayout)
  }, [options.commits, options.enabled, options.loading, scheduleLayout])

  useEffect(() => {
    return () => {
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
