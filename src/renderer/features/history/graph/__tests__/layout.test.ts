import { describe, expect, it } from 'vitest'
import { createLaneWalker, seekLanes } from '@/features/history/graph/lane-walker'
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

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: 'msg',
    author_name: 'Jane Doe',
    date: '2024-01-01T00:00:00.000Z',
    parents,
    refs: ''
  }
}

function topologyOf(
  commits: GitLogEntry[],
  isHiddenParent?: (hash: string) => boolean
): GraphTopology {
  return buildGraphTopology(commits, { isHiddenParent })
}

interface Graph {
  layout: GraphLayout
  topology: GraphTopology
}

function graphOf(commits: GitLogEntry[], isHiddenParent?: (hash: string) => boolean): Graph {
  const topology = topologyOf(commits, isHiddenParent)
  return { layout: layoutGraph(topology), topology }
}

function lanes(graph: Graph | GraphLayout): number[] {
  return [...('layout' in graph ? graph.layout : graph).commitLane]
}

function boundaries(graph: Graph): number[][] {
  return Array.from({ length: graph.layout.commitCount + 1 }, (_unused, boundary) =>
    ownersAt(graph, boundary)
  )
}

function ownersAt(graph: Graph, boundary: number): number[] {
  const walker = createLaneWalker()
  seekLanes(walker, graph.layout, graph.topology, boundary)
  return [...walker.lanes.subarray(0, walker.laneCount)]
}

describe('layoutGraph', () => {
  it('places a single linear chain in lane 0', () => {
    const graph = graphOf([entry('c1', ['c2']), entry('c2', ['c3']), entry('c3')])

    expect(graph.layout.maxLanes).toBe(1)
    expect(graph.layout.commitCount).toBe(3)
    expect(lanes(graph)).toEqual([0, 0, 0])
    expect(ownersAt(graph, 3)).toEqual([])
  })

  it('hands each row the lane its parent will occupy next', () => {
    const graph = graphOf([entry('c1', ['c2']), entry('c2', ['c3']), entry('c3')])

    expect(ownersAt(graph, 1)).toEqual([1])
    expect(ownersAt(graph, 2)).toEqual([2])
  })

  it('opens a second lane when a sibling branch tip appears', () => {
    const graph = graphOf([entry('c1', ['c3']), entry('c2', ['c3']), entry('c3')])

    expect(graph.layout.maxLanes).toBe(2)
    expect(lanes(graph)).toEqual([0, 1, 0])
    expect(ownersAt(graph, 3)).toEqual([])
  })

  it('expands a merge into one lane per parent', () => {
    const graph = graphOf([
      entry('c1', ['c2', 'c3']),
      entry('c2', ['c4']),
      entry('c3', ['c4']),
      entry('c4')
    ])

    expect(graph.layout.maxLanes).toBe(2)
    expect(graph.layout.commitLane[0]).toBe(0)
    expect(ownersAt(graph, 1).sort()).toEqual([1, 2])
    expect(ownersAt(graph, 4)).toEqual([])
  })

  it('keeps a merge near-linear when its side parent is hidden by collapse', () => {
    const graph = graphOf(
      [entry('M', ['m2', 'f1']), entry('m2', ['m1']), entry('m1')],
      (hash) => hash === 'f1'
    )

    expect(graph.layout.maxLanes).toBe(1)
    expect(lanes(graph)).toEqual([0, 0, 0])
  })

  it('still opens a lane for a not-yet-streamed parent', () => {
    const graph = graphOf([entry('M', ['m2', 'pending'])])

    expect(ownersAt(graph, 1)).toHaveLength(2)
    expect(graph.layout.maxLanes).toBe(2)
  })

  it('gives every parent of an octopus merge a distinct lane', () => {
    const graph = graphOf([entry('m', ['p1', 'p2', 'p3']), entry('p1'), entry('p2'), entry('p3')])

    const outgoing = ownersAt(graph, 1)
    expect(new Set(outgoing).size).toBe(3)
    expect(outgoing).not.toContain(-1)
    expect(graph.layout.maxLanes).toBeGreaterThanOrEqual(3)
  })

  it('reuses a lane freed by an earlier branch tip', () => {
    const graph = graphOf([entry('a', ['c']), entry('b', ['d']), entry('c', []), entry('d', [])])

    expect(lanes(graph)).toEqual([0, 1, 0, 1])
  })

  it('records the lanes each row needs so a row can size its own rail', () => {
    const graph = graphOf([
      entry('m', ['a', 'b']),
      entry('a', ['c']),
      entry('b', ['c']),
      entry('c')
    ])

    expect([...graph.layout.railLanes]).toEqual([2, 2, 2, 1])
  })

  it('never reserves two lanes for the same commit', () => {
    const graph = graphOf([
      entry('m', ['a', 'b']),
      entry('x', ['a']),
      entry('a', ['base']),
      entry('b', ['base']),
      entry('base')
    ])

    for (let boundary = 0; boundary <= graph.layout.commitCount; boundary++) {
      const owners = ownersAt(graph, boundary).filter((owner) => owner !== -1)
      expect(new Set(owners).size).toBe(owners.length)
    }
  })

  it('reports the widest row as maxLanes', () => {
    const graph = graphOf([
      entry('m', ['a', 'b']),
      entry('a', ['c']),
      entry('b', ['c']),
      entry('c')
    ])

    expect(graph.layout.maxLanes).toBe(Math.max(...graph.layout.railLanes))
  })
})

function relayout(previous: Graph, commits: GitLogEntry[]): Graph {
  const topology = topologyOf(commits)
  const carried = alignRowsToCheckpoint(sharedTopologyRows(previous.topology, topology))
  const layout = layoutGraph(sliceTopology(topology, carried), {
    layout: previous.layout,
    rows: carried
  })
  return { layout, topology }
}

function longChain(total: number, from = 0): GitLogEntry[] {
  return Array.from({ length: total }, (_unused, index) =>
    entry(
      `c${from + index}`,
      index % 30 === 0 && index + 3 < total
        ? [`c${from + index + 1}`, `c${from + index + 3}`]
        : index < total - 1
          ? [`c${from + index + 1}`]
          : []
    )
  )
}

describe('layoutGraph reuse', () => {
  it('produces the same layout resuming from a checkpoint as in one pass', () => {
    const page1 = longChain(300)
    const page2 = [...page1.slice(0, 299), entry('c299', ['c300']), ...longChain(200, 300)]
    const first = graphOf(page1)

    const extended = relayout(first, page2)

    expect(extended.layout.commitCount).toBe(500)
    expect(lanes(extended)).toEqual(lanes(graphOf(page2)))
    expect(boundaries(extended)).toEqual(boundaries(graphOf(page2)))
    expect([...extended.layout.railLanes]).toEqual([...graphOf(page2).layout.railLanes])
    expect(extended.layout.maxLanes).toBe(graphOf(page2).layout.maxLanes)
  })

  it('leaves the reused layout untouched', () => {
    const page1 = longChain(300)
    const first = graphOf(page1)
    const before = lanes(first)

    relayout(first, [...page1.slice(0, 299), entry('c299', ['c300']), ...longChain(200, 300)])

    expect(lanes(first)).toEqual(before)
    expect(first.layout.commitCount).toBe(300)
  })

  it('rebuilds from scratch when no rows carry over', () => {
    const first = graphOf(longChain(300))
    const replaced = [entry('m', ['a', 'b']), entry('a'), entry('b')]

    const rebuilt = relayout(first, replaced)

    expect(lanes(rebuilt)).toEqual(lanes(graphOf(replaced)))
  })

  it('rebuilds from scratch when the shared prefix is shorter than one checkpoint', () => {
    const page1 = [entry('a', ['b']), entry('b')]
    const first = graphOf(page1)

    const extended = relayout(first, [...page1.slice(0, 1), entry('b', ['z']), entry('z')])

    expect(lanes(extended)).toEqual(
      lanes(graphOf([entry('a', ['b']), entry('b', ['z']), entry('z')]))
    )
  })

  it('refuses to resume from a row that is not a checkpoint', () => {
    const first = graphOf(longChain(300))

    expect(() =>
      layoutGraph(sliceTopology(first.topology, 5), { layout: first.layout, rows: 5 })
    ).toThrow()
  })

  it('handles an empty log', () => {
    const graph = graphOf([])

    expect(graph.layout.commitCount).toBe(0)
    expect(graph.layout.maxLanes).toBe(0)
    expect(ownersAt(graph, 0)).toEqual([])
  })
})
