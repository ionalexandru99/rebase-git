import { describe, expect, it } from 'vitest'
import {
  alignRowsToCheckpoint,
  type GraphLayout,
  layoutGraph
} from '@/features/history/graph/layout'
import {
  buildGraphTopology,
  type GraphTopology,
  sharedTopologyRows,
  sliceTopology
} from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'
import {
  collectTimelineTips,
  computeCollapsedView,
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  getCommitIndex,
  refFilterKey
} from '../selectors'

// One coalesced streaming tick: everything the history panel derives from a freshly published log
// array, in the order it runs. Guards the whole main-thread cost of a tick, not one selector.
const REMOTE_NAMES = new Set(['origin'])
const VISIBLE_REFS = new Set([refFilterKey('local', 'main')])
const NO_MERGES: ReadonlySet<string> = new Set()

function buildHistory(commitCount: number): GitLogEntry[] {
  return Array.from({ length: commitCount }, (_unused, index) => ({
    hash: `commit-${index}`,
    message: `commit ${index} touching a handful of files`,
    author_name: 'Author',
    date: '2024-01-01T00:00:00.000Z',
    // Every 100th commit merges a two-commit side branch back into the mainline.
    parents:
      index % 100 === 0 && index + 2 < commitCount
        ? [`commit-${index + 1}`, `commit-${index + 2}`]
        : index < commitCount - 1
          ? [`commit-${index + 1}`]
          : [],
    refs: index === 0 ? 'HEAD -> main' : ''
  }))
}

interface Tick {
  topology: GraphTopology
  layout: GraphLayout
  filtered: GitLogEntry[]
  mergeSideRanges: ReturnType<typeof computeMergeSideRangeIndex>
  onBranch: Set<string> | null
  carried: number
}

function runTick(commits: GitLogEntry[], previous?: Tick): Tick {
  const tips = collectTimelineTips(commits, VISIBLE_REFS, [], REMOTE_NAMES, 'main')
  const displayed = computeCollapsedView(commits, tips, NO_MERGES)
  const filtered = commits.filter((commit) => displayed.has(commit.hash))
  const mergeSideRanges = computeMergeSideRangeIndex(commits, filtered, displayed, NO_MERGES, tips)
  const onBranch = computeOnBranchSet(commits, REMOTE_NAMES, 'main')
  const positions = getCommitIndex(filtered).positionByHash
  const loaded = getCommitIndex(commits).byHash
  const topology = buildGraphTopology(filtered, {
    rowOf: (hash) => positions.get(hash),
    isHiddenParent: (hash) => loaded.has(hash) && !displayed.has(hash)
  })
  const carried = previous
    ? alignRowsToCheckpoint(sharedTopologyRows(previous.topology, topology))
    : 0
  const layout =
    carried > 0 && previous
      ? layoutGraph(sliceTopology(topology, carried), { layout: previous.layout, rows: carried })
      : layoutGraph(topology)
  return { topology, layout, filtered, mergeSideRanges, onBranch, carried }
}

function measure(run: () => void): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

describe('history streaming tick', () => {
  it('derives everything a 50k-commit tick needs within frame budget', () => {
    runTick(buildHistory(50_000))
    // A fresh array with the same content, exactly what a coalesced flush publishes.
    const republished = buildHistory(50_000)

    const elapsed = measure(() => {
      runTick(republished)
    })

    // Roughly 40ms on a warm machine; the headroom absorbs a loaded CI box running suites in
    // parallel while still catching an order-of-magnitude regression.
    expect(elapsed).toBeLessThan(250)
  })

  it('reuses the whole previous layout when a page is appended', () => {
    const page1 = buildHistory(50_000)
    const first = runTick(page1)
    const page2 = [
      ...page1.slice(0, 49_999),
      { ...page1[49_999], parents: ['commit-50000'] },
      ...buildHistory(2_000).map((commit, index) => ({
        ...commit,
        hash: `commit-${50_000 + index}`,
        parents: index < 1_999 ? [`commit-${50_001 + index}`] : []
      }))
    ]

    const second = runTick(page2, first)

    expect(second.carried).toBe(alignRowsToCheckpoint(49_999))
    expect(second.layout.commitCount).toBe(52_000)
    // The carried rows have to be indistinguishable from a full relayout, or reuse is just a lie
    // that happens to be fast.
    expect([...second.layout.commitLane]).toEqual([...runTick(page2).layout.commitLane])
    expect([...second.layout.railLanes]).toEqual([...runTick(page2).layout.railLanes])
  })
})
