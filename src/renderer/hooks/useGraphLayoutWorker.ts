import { GRAPH_LAYOUT_DEBOUNCE_MS } from '@shared/graph-config'
import type { LayoutResultMessage } from '@shared/graph-layout-protocol'
import { attachCommitsToLayoutRows, type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
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
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const applyLayoutResult = (commits: GitLogEntry[], message: LayoutResultMessage) => {
    const rows = attachCommitsToLayoutRows(commits, message.rows)
    setState({
      layout: {
        rows,
        maxLanes: message.maxLanes,
        lanesAfter: [...message.lanesAfter],
        commits: commits.slice(0, message.toIndex),
        laidOutThroughIndex: message.toIndex
      },
      layoutPending: false,
      laidOutThroughIndex: message.toIndex
    })
  }

  const runLayoutSync = (
    commits: GitLogEntry[],
    targetEnd: number,
    prev?: LayoutResult | null
  ): LayoutResultMessage => {
    const extending = prev && targetEnd > prev.laidOutThroughIndex && prev.rows.length > 0
    const result = layoutCommits(commits, extending ? prev : undefined, {
      startIndex: extending ? prev.laidOutThroughIndex : undefined,
      endIndex: targetEnd
    })
    return {
      type: 'layout-result',
      generation: 0,
      rows: result.rows.map((row) => ({
        commitLane: row.commitLane,
        incoming: row.incoming,
        outgoing: row.outgoing
      })),
      maxLanes: result.maxLanes,
      lanesAfter: result.lanesAfter,
      fromIndex: extending ? prev.laidOutThroughIndex : 0,
      toIndex: result.laidOutThroughIndex
    }
  }

  const layoutToTarget = (commits: GitLogEntry[], targetEnd: number, reset: boolean) => {
    const prev = reset ? null : state().layout
    if (reset) {
      setState(createEmptyState())
    } else {
      setState((current) => ({ ...current, layoutPending: true }))
    }

    const message = runLayoutSync(commits, targetEnd, prev)
    applyLayoutResult(commits, message)
  }

  const scheduleLayout = (commits: GitLogEntry[], immediate: boolean) => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    if (commits.length === 0) {
      setState(createEmptyState())
      return
    }

    const run = () => {
      const snapshot = untrack(() => state())
      const prevCommits = snapshot.layout?.commits ?? []
      const sameSequence =
        prevCommits.length === commits.length &&
        commits.every((commit, index) => commit.hash === prevCommits[index]?.hash)

      if (sameSequence && snapshot.layout) {
        return
      }

      const extendable =
        sameLayoutPrefix(commits, snapshot.layout) &&
        commits.length > prevCommits.length &&
        prevCommits.every((commit, index) => commit.hash === commits[index]?.hash)

      layoutToTarget(commits, commits.length, !extendable)
    }

    if (immediate) {
      run()
      return
    }

    debounceTimer = setTimeout(run, debounceMs)
  }

  createEffect(() => {
    if (!options.enabled()) {
      return
    }
    const commits = options.commits()
    const loading = options.loading()
    const needsInitialLayout = commits.length > 0 && untrack(() => state().layout) === null
    scheduleLayout(commits, !loading || needsInitialLayout)
  })

  onCleanup(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
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
