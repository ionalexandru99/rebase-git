import { describe, expect, it } from 'vitest'
import { getLayoutBoundary, getLayoutRow, layoutCommits, layoutRows } from '@/lib/git-graph/layout'
import type { GitLogEntry } from '@/types'

function entry(overrides: Partial<GitLogEntry> & Pick<GitLogEntry, 'hash'>): GitLogEntry {
  return {
    message: 'msg',
    author_name: 'Jane Doe',
    date: new Date().toISOString(),
    parents: [],
    refs: '',
    ...overrides
  }
}

describe('layoutCommits', () => {
  it('places a single linear chain in lane 0', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c2'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const layout = layoutCommits(commits)
    const rows = layoutRows(layout)

    expect(layout.maxLanes).toBe(1)
    expect(layout.laidOutThroughIndex).toBe(3)
    expect(rows.map((row) => row.commitLane)).toEqual([0, 0, 0])
    expect(getLayoutBoundary(layout, 3)).toEqual([])
  })

  it('stores each lane boundary once across adjacent rows', () => {
    const commits = [
      entry({ hash: 'c1', parents: ['c2'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const layout = layoutCommits(commits)

    expect(layout.boundaryCount).toBe(layout.rowCount + 1)
    expect(getLayoutBoundary(layout, 1)).toEqual(['c2'])
    expect(getLayoutBoundary(layout, 2)).toEqual(['c3'])
  })

  it('opens a second lane when a sibling branch tip appears', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c3'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const layout = layoutCommits(commits)
    const rows = layoutRows(layout)

    expect(layout.maxLanes).toBe(2)
    expect(rows[0].commitLane).toBe(0)
    expect(rows[1].commitLane).toBe(1)
    expect(rows[2].commitLane).toBe(0)
    expect(getLayoutBoundary(layout, 3)).toEqual([])
  })

  it('handles a merge commit by expanding into two outgoing lanes', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c2', 'c3'] }),
      entry({ hash: 'c2', parents: ['c4'] }),
      entry({ hash: 'c3', parents: ['c4'] }),
      entry({ hash: 'c4', parents: [] })
    ]

    const layout = layoutCommits(commits)
    const rows = layoutRows(layout)

    expect(layout.maxLanes).toBe(2)
    expect(rows[0].commitLane).toBe(0)
    expect(getLayoutBoundary(layout, 1)).toHaveLength(2)
    expect(getLayoutBoundary(layout, 1)).toContain('c2')
    expect(getLayoutBoundary(layout, 1)).toContain('c3')
    expect(getLayoutBoundary(layout, 4)).toEqual([])
  })

  it('keeps a merge near-linear when its side parent is hidden by collapse', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'M', parents: ['m2', 'f1'] }),
      entry({ hash: 'm2', parents: ['m1'] }),
      entry({ hash: 'm1', parents: [] })
    ]

    const layout = layoutCommits(commits, undefined, {
      isHiddenParent: (hash) => hash === 'f1'
    })
    const rows = layoutRows(layout)

    expect(layout.maxLanes).toBe(1)
    expect(getLayoutBoundary(layout, 1)).not.toContain('f1')
    expect(rows.map((row) => row.commitLane)).toEqual([0, 0, 0])
  })

  it('still opens a lane for a not-yet-streamed parent', () => {
    const commits: GitLogEntry[] = [entry({ hash: 'M', parents: ['m2', 'pending'] })]

    const layout = layoutCommits(commits, undefined, {
      isHiddenParent: (hash) => hash === 'f1'
    })

    expect(getLayoutBoundary(layout, 1)).toContain('pending')
  })

  it('gives every parent of an octopus merge a distinct lane', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'm', parents: ['p1', 'p2', 'p3'] }),
      entry({ hash: 'p1', parents: [] }),
      entry({ hash: 'p2', parents: [] }),
      entry({ hash: 'p3', parents: [] })
    ]

    const layout = layoutCommits(commits)

    const outgoing = getLayoutBoundary(layout, 1)
    const parentLanes = ['p1', 'p2', 'p3'].map((parent) => outgoing.indexOf(parent))
    expect(parentLanes).not.toContain(-1)
    expect(new Set(parentLanes).size).toBe(3)
    expect(layout.maxLanes).toBeGreaterThanOrEqual(3)
  })

  it('does not mutate the previous snapshot when appending incrementally', () => {
    const prefix = [entry({ hash: 'c1', parents: ['c2'] }), entry({ hash: 'c2', parents: [] })]
    const step1 = layoutCommits(prefix)
    const step2 = layoutCommits([...prefix, entry({ hash: 'c3', parents: ['c2'] })], step1)

    expect(step2.rowChunks[0]).toBe(step1.rowChunks[0])
    expect(step2.boundaryChunks[0]).toBe(step1.boundaryChunks[0])
    expect(step1.rowCount).toBe(2)
    expect(step2.rowCount).toBe(3)
    expect(
      layoutRows(step2)
        .slice(0, 2)
        .map((row) => row.commit.hash)
    ).toEqual(['c1', 'c2'])
  })

  it('produces the same layout incrementally as in one pass', () => {
    const all: GitLogEntry[] = [
      entry({ hash: 'a', parents: ['b', 'c'] }),
      entry({ hash: 'b', parents: ['d'] }),
      entry({ hash: 'c', parents: ['d'] }),
      entry({ hash: 'd', parents: ['e'] }),
      entry({ hash: 'e', parents: [] })
    ]

    const full = layoutCommits(all)

    const prefix = all.slice(0, 2)
    const step1 = layoutCommits(prefix)
    const step2 = layoutCommits(all, step1)

    expect(step2.maxLanes).toBe(full.maxLanes)
    expect(layoutRows(step2).map((row) => row.commitLane)).toEqual(
      layoutRows(full).map((row) => row.commitLane)
    )
    expect(
      Array.from({ length: step2.boundaryCount }, (_unused, index) =>
        getLayoutBoundary(step2, index)
      )
    ).toEqual(
      Array.from({ length: full.boundaryCount }, (_unused, index) => getLayoutBoundary(full, index))
    )
  })

  it('does not let later mutations of the source array corrupt incremental layout', () => {
    const commits = [entry({ hash: 'a', parents: ['b'] })]
    const step1 = layoutCommits(commits)

    commits.push(entry({ hash: 'b', parents: ['c'] }), entry({ hash: 'c', parents: [] }))
    const step2 = layoutCommits(commits, step1)

    expect(step2.rowCount).toBe(3)
    expect(layoutRows(step2).map((row) => row.commit.hash)).toEqual(['a', 'b', 'c'])
  })

  it('rebuilds from scratch when the cached prefix no longer matches', () => {
    const cached = layoutCommits([entry({ hash: 'x', parents: [] })])
    const fresh = layoutCommits([entry({ hash: 'y', parents: [] })], cached)

    expect(fresh.rowCount).toBe(1)
    expect(getLayoutRow(fresh, 0)?.commit.hash).toBe('y')
  })

  it('rebuilds from scratch when a commit inside the cached prefix changes', () => {
    const cached = layoutCommits([
      entry({ hash: 'a', parents: ['b'] }),
      entry({ hash: 'b', parents: ['c'] }),
      entry({ hash: 'c', parents: [] })
    ])
    const fresh = layoutCommits(
      [
        entry({ hash: 'a', parents: ['x'] }),
        entry({ hash: 'x', parents: ['c'] }),
        entry({ hash: 'c', parents: [] }),
        entry({ hash: 'd', parents: [] })
      ],
      cached
    )

    expect(layoutRows(fresh).map((row) => row.commit.hash)).toEqual(['a', 'x', 'c', 'd'])
    expect(fresh.rowChunks[0]).not.toBe(cached.rowChunks[0])
  })

  it('respects maxCommits cap', () => {
    const commits = Array.from({ length: 20 }, (_unused, index) =>
      entry({ hash: `c${index}`, parents: index < 19 ? [`c${index + 1}`] : [] })
    )
    const result = layoutCommits(commits, undefined, { maxCommits: 5 })

    expect(result.rowCount).toBe(5)
    expect(result.laidOutThroughIndex).toBe(5)
    expect(result.commits).toHaveLength(5)
  })

  it('extends a window from a previous layout snapshot', () => {
    const commits = Array.from({ length: 6 }, (_unused, index) =>
      entry({ hash: `c${index}`, parents: index < 5 ? [`c${index + 1}`] : [] })
    )
    const first = layoutCommits(commits, undefined, { endIndex: 3 })
    const extended = layoutCommits(commits, first, {
      startIndex: first.laidOutThroughIndex,
      endIndex: 6
    })

    expect(extended.rowCount).toBe(6)
    expect(extended.laidOutThroughIndex).toBe(6)
    expect(layoutRows(extended).map((row) => row.commitLane)).toEqual(
      layoutRows(layoutCommits(commits)).map((row) => row.commitLane)
    )
  })

  it('defaults maxCommits to full commit list length', () => {
    const commits = [entry({ hash: 'a', parents: [] })]
    const result = layoutCommits(commits)
    expect(result.laidOutThroughIndex).toBe(1)
    expect(result.rowCount).toBe(1)
  })
})
