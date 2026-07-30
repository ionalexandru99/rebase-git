import { describe, expect, it } from 'vitest'
import { createLaneWalker, seekLanes, stepLanes } from '@/features/history/graph/lane-walker'
import { type GraphLayout, layoutGraph } from '@/features/history/graph/layout'
import {
  buildGraphTopology,
  EMPTY_LANE,
  type GraphTopology
} from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: '2024-01-01T00:00:00.000Z',
    parents,
    refs: ''
  }
}

function allBoundaries(layout: GraphLayout, topology: GraphTopology): number[][] {
  const walker = createLaneWalker()
  seekLanes(walker, layout, topology, 0)
  const boundaries: number[][] = [[...walker.lanes.subarray(0, walker.laneCount)]]
  for (let row = 0; row < layout.commitCount; row++) {
    stepLanes(walker, topology)
    boundaries.push([...walker.lanes.subarray(0, walker.laneCount)])
  }
  return boundaries
}

function chainWithBranches(total: number): GitLogEntry[] {
  return Array.from({ length: total }, (_unused, index) => {
    const parents: string[] = []
    if (index < total - 1) {
      parents.push(`c${index + 1}`)
    }
    if (index % 7 === 0 && index + 3 < total) {
      parents.push(`c${index + 3}`)
    }
    return entry(`c${index}`, parents)
  })
}

describe('lane walker', () => {
  it('reproduces the lane state entering any row', () => {
    const commits = chainWithBranches(400)
    const topology = buildGraphTopology(commits)
    const layout = layoutGraph(topology)
    const expected = allBoundaries(layout, topology)

    for (const row of [0, 1, 5, 127, 128, 129, 200, 399, 400]) {
      const walker = createLaneWalker()
      seekLanes(walker, layout, topology, row)
      expect([...walker.lanes.subarray(0, walker.laneCount)]).toEqual(expected[row])
    }
  })

  it('lands on the same lanes whether it seeks or steps there', () => {
    const commits = chainWithBranches(300)
    const topology = buildGraphTopology(commits)
    const layout = layoutGraph(topology)

    const stepped = createLaneWalker()
    seekLanes(stepped, layout, topology, 0)
    for (let row = 0; row < 250; row++) {
      stepLanes(stepped, topology)
    }
    const sought = createLaneWalker()
    seekLanes(sought, layout, topology, 250)

    expect([...sought.lanes.subarray(0, sought.laneCount)]).toEqual([
      ...stepped.lanes.subarray(0, stepped.laneCount)
    ])
  })

  it('reports the lane each commit was placed in as it walks', () => {
    const commits = chainWithBranches(50)
    const topology = buildGraphTopology(commits)
    const layout = layoutGraph(topology)
    const walker = createLaneWalker()

    seekLanes(walker, layout, topology, 0)
    for (let row = 0; row < layout.commitCount; row++) {
      stepLanes(walker, topology)
      expect(walker.commitLane).toBe(layout.commitLane[row])
    }
  })

  it('keeps the boundary it stepped from available as the incoming side', () => {
    const commits = [
      entry('m', ['a', 'b']),
      entry('a', ['base']),
      entry('b', ['base']),
      entry('base')
    ]
    const topology = buildGraphTopology(commits)
    const layout = layoutGraph(topology)
    const walker = createLaneWalker()

    seekLanes(walker, layout, topology, 1)
    const incoming = [...walker.lanes.subarray(0, walker.laneCount)]
    stepLanes(walker, topology)

    expect([...walker.incoming.subarray(0, walker.incomingCount)]).toEqual(incoming)
    expect(walker.lanes.subarray(0, walker.laneCount)).not.toEqual(walker.incoming)
  })

  it('seeks into an empty log without walking anything', () => {
    const topology = buildGraphTopology([])
    const layout = layoutGraph(topology)
    const walker = createLaneWalker()

    seekLanes(walker, layout, topology, 0)

    expect(walker.laneCount).toBe(0)
  })

  it('frees the lane of the commit it just stepped over', () => {
    const commits = [entry('a', ['b']), entry('b')]
    const topology = buildGraphTopology(commits)
    const layout = layoutGraph(topology)
    const walker = createLaneWalker()

    seekLanes(walker, layout, topology, 1)
    stepLanes(walker, topology)

    expect(
      [...walker.lanes.subarray(0, walker.laneCount)].filter((lane) => lane !== EMPTY_LANE)
    ).toEqual([])
  })
})
