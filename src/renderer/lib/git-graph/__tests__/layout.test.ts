import { describe, expect, it } from 'vitest'
import { layoutCommits } from '@/lib/git-graph/layout'
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

    const { rows, maxLanes, laidOutThroughIndex } = layoutCommits(commits)

    expect(maxLanes).toBe(1)
    expect(laidOutThroughIndex).toBe(3)
    expect(rows.map((row) => row.commitLane)).toEqual([0, 0, 0])
    expect(rows[2].outgoing).toEqual([])
  })

  it('opens a second lane when a sibling branch tip appears', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c3'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const { rows, maxLanes } = layoutCommits(commits)

    expect(maxLanes).toBe(2)
    expect(rows[0].commitLane).toBe(0)
    expect(rows[1].commitLane).toBe(1)
    expect(rows[2].commitLane).toBe(0)
    expect(rows[2].outgoing).toEqual([])
  })

  it('handles a merge commit by expanding into two outgoing lanes', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c2', 'c3'] }),
      entry({ hash: 'c2', parents: ['c4'] }),
      entry({ hash: 'c3', parents: ['c4'] }),
      entry({ hash: 'c4', parents: [] })
    ]

    const { rows, maxLanes } = layoutCommits(commits)

    expect(maxLanes).toBe(2)
    expect(rows[0].commitLane).toBe(0)
    expect(rows[0].outgoing.length).toBe(2)
    expect(rows[0].outgoing).toContain('c2')
    expect(rows[0].outgoing).toContain('c3')
    expect(rows[3].outgoing).toEqual([])
  })

  it('does not mutate the previous snapshot when appending incrementally', () => {
    const prefix = [entry({ hash: 'c1', parents: ['c2'] }), entry({ hash: 'c2', parents: [] })]
    const step1 = layoutCommits(prefix)
    const step2 = layoutCommits([...prefix, entry({ hash: 'c3', parents: ['c2'] })], step1)

    expect(step2.rows).not.toBe(step1.rows)
    expect(step1.rows).toHaveLength(2)
    expect(step2.rows).toHaveLength(3)
    expect(step2.rows.slice(0, 2).map((row) => row.commit.hash)).toEqual(['c1', 'c2'])
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
    expect(step2.rows.map((row) => row.commitLane)).toEqual(full.rows.map((row) => row.commitLane))
    expect(step2.rows.map((row) => row.outgoing)).toEqual(full.rows.map((row) => row.outgoing))
    expect(step2.rows.map((row) => row.incoming)).toEqual(full.rows.map((row) => row.incoming))
  })

  it('does not let later mutations of the source array corrupt incremental layout', () => {
    const commits = [entry({ hash: 'a', parents: ['b'] })]
    const step1 = layoutCommits(commits)

    commits.push(entry({ hash: 'b', parents: ['c'] }), entry({ hash: 'c', parents: [] }))
    const step2 = layoutCommits(commits, step1)

    expect(step2.rows).toHaveLength(3)
    expect(step2.rows.map((row) => row.commit.hash)).toEqual(['a', 'b', 'c'])
  })

  it('rebuilds from scratch when the cached prefix no longer matches', () => {
    const cached = layoutCommits([entry({ hash: 'x', parents: [] })])
    const fresh = layoutCommits([entry({ hash: 'y', parents: [] })], cached)

    expect(fresh.rows).toHaveLength(1)
    expect(fresh.rows[0].commit.hash).toBe('y')
  })

  it('respects maxCommits cap', () => {
    const commits = Array.from({ length: 20 }, (_unused, index) =>
      entry({ hash: `c${index}`, parents: index < 19 ? [`c${index + 1}`] : [] })
    )
    const result = layoutCommits(commits, undefined, { maxCommits: 5 })

    expect(result.rows).toHaveLength(5)
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

    expect(extended.rows).toHaveLength(6)
    expect(extended.laidOutThroughIndex).toBe(6)
    expect(extended.rows.map((row) => row.commitLane)).toEqual(
      layoutCommits(commits).rows.map((row) => row.commitLane)
    )
  })

  it('defaults maxCommits to full commit list length', () => {
    const commits = [entry({ hash: 'a', parents: [] })]
    const result = layoutCommits(commits)
    expect(result.laidOutThroughIndex).toBe(1)
    expect(result.rows).toHaveLength(1)
  })
})
