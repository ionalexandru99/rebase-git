import { describe, expect, it } from 'vitest'
import { alignRowsToCheckpoint, layoutGraph } from '@/features/history/graph/layout'
import {
  buildGraphTopology,
  sharedTopologyRows,
  sliceTopology
} from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'

const FIXED_DATE = '2024-01-01T00:00:00.000Z'

function entry(hash: string, parents: string[]): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: FIXED_DATE,
    parents,
    refs: ''
  }
}

function buildLinearCommits(total: number): GitLogEntry[] {
  return Array.from({ length: total }, (_unused, index) =>
    entry(`commit-${index}`, index < total - 1 ? [`commit-${index + 1}`] : [])
  )
}

function buildFanOutCommits(total: number, branchCount: number): GitLogEntry[] {
  const commits: GitLogEntry[] = []
  for (let index = 0; index < total; index++) {
    const mainParent = index + branchCount
    const parents: string[] = []
    if (mainParent < total) {
      parents.push(`commit-${mainParent}`)
    }
    if (index % 50 === 0 && mainParent + 1 < total) {
      parents.push(`commit-${mainParent + 1}`)
    }
    commits.push(entry(`commit-${index}`, parents))
  }
  return commits
}

function measureFastest(run: () => void, samples = 3): number {
  let fastest = Number.POSITIVE_INFINITY
  for (let sample = 0; sample < samples; sample++) {
    const started = performance.now()
    run()
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}

describe('graph layout performance', () => {
  it('lays out 10k linear commits within budget', () => {
    const topology = buildGraphTopology(buildLinearCommits(10_000))
    let rowCount = 0
    const elapsed = measureFastest(() => {
      rowCount = layoutGraph(topology).commitCount
    })

    expect(rowCount).toBe(10_000)
    expect(elapsed).toBeLessThan(40)
  })

  it('lays out 10k commits across 300 interleaved branches within budget', () => {
    const topology = buildGraphTopology(buildFanOutCommits(10_000, 300))
    const layout = layoutGraph(topology)
    const elapsed = measureFastest(() => {
      layoutGraph(topology)
    })

    expect(layout.commitCount).toBe(10_000)
    expect(layout.maxLanes).toBeGreaterThan(100)
    expect(elapsed).toBeLessThan(120)
  })

  it('lays out 50k commits across 64 live lanes within scale budgets', () => {
    const topology = buildGraphTopology(buildFanOutCommits(50_000, 64))
    const layout = layoutGraph(topology)
    const elapsed = measureFastest(() => {
      layoutGraph(topology)
    })

    expect(layout.commitCount).toBe(50_000)
    expect(layout.maxLanes).toBeGreaterThanOrEqual(64)
    expect(elapsed).toBeLessThan(120)
  })

  it('stores a wide 50k history in a fraction of a lane-per-row table', () => {
    const layout = layoutGraph(buildGraphTopology(buildFanOutCommits(50_000, 64)))
    const bytes =
      bytesOf(layout.commitLane) +
      bytesOf(layout.railLanes) +
      bytesOf(layout.checkpointLanes) +
      bytesOf(layout.checkpointOffsets)

    expect(layout.commitCount).toBe(50_000)
    expect(bytes).toBeLessThan(1_000_000)
  })

  it('extends a streamed page in a fraction of a full relayout', () => {
    const page1 = buildFanOutCommits(50_000, 64)
    const page2 = [
      ...page1,
      ...buildFanOutCommits(2_000, 64).map((commit) =>
        entry(
          `page2-${commit.hash}`,
          commit.parents.map((parent) => `page2-${parent}`)
        )
      )
    ]
    const topology1 = buildGraphTopology(page1)
    const layout1 = layoutGraph(topology1)
    const topology2 = buildGraphTopology(page2)
    const carried = alignRowsToCheckpoint(sharedTopologyRows(topology1, topology2))
    const tail = sliceTopology(topology2, carried)

    const extendElapsed = measureFastest(() => {
      layoutGraph(tail, { layout: layout1, rows: carried })
    })

    expect(carried).toBe(alignRowsToCheckpoint(50_000))
    expect(extendElapsed).toBeLessThan(10)
  })
})

function bytesOf(buffer: Int32Array): number {
  return buffer.byteLength
}
