import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistoryPanel } from '@/components/HistoryPanel'
import { layoutCommits } from '@/lib/git-graph/layout'
import { parseRefs } from '@/lib/git-graph/refs'
import type { GitLog, GitLogEntry } from '@/types'

function renderPanel(log: GitLog | null, loading = false) {
  return render(<HistoryPanel log={log} loading={loading} />)
}

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

describe('HistoryPanel', () => {
  it('shows the empty state when there are no commits', () => {
    renderPanel({ all: [], total: 0 })

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
    expect(screen.getByText(/Make your first commit/)).toBeInTheDocument()
  })

  it('shows the empty state when log is null', () => {
    renderPanel(null)

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
  })

  it('renders a commit list with hash, message, and author initials', () => {
    renderPanel({
      all: [
        entry({
          hash: '1234567890abcdef',
          message: 'Add support for sparse checkouts',
          author_name: 'Jane Doe',
          parents: ['abcdef1234567890']
        }),
        entry({
          hash: 'abcdef1234567890',
          message: 'Refactor commit panel',
          author_name: 'Alex Smith',
          date: new Date(Date.now() - 3600_000).toISOString()
        })
      ],
      total: 2
    })

    expect(screen.getByText('2 commits · all branches')).toBeInTheDocument()
    expect(screen.getByText('Add support for sparse checkouts')).toBeInTheDocument()
    expect(screen.getByText('Refactor commit panel')).toBeInTheDocument()
    expect(screen.getByText('1234567')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('uses singular copy for one commit', () => {
    renderPanel({
      all: [entry({ hash: 'aaa', message: 'one', author_name: 'Solo' })],
      total: 1
    })

    expect(screen.getByText('1 commit · all branches')).toBeInTheDocument()
  })

  it('shows the loading badge', () => {
    renderPanel({ all: [], total: 0 }, true)

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('renders branch and HEAD ref chips parsed from %D output', () => {
    renderPanel({
      all: [
        entry({
          hash: 'aaa',
          message: 'tip commit',
          refs: 'HEAD -> main, origin/main, tag: v1.0'
        })
      ],
      total: 1
    })

    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.queryByText('origin/main')).not.toBeInTheDocument()
    expect(screen.getByText('v1.0')).toBeInTheDocument()
  })

  it('keeps the remote ref when no local branch is at the same SHA', () => {
    renderPanel({
      all: [
        entry({
          hash: 'aaa',
          message: 'tip',
          refs: 'origin/feature'
        })
      ],
      total: 1
    })

    expect(screen.getByTitle('origin/feature')).toBeInTheDocument()
    expect(screen.getByText('feature')).toBeInTheDocument()
  })

  it('virtualizes a large history, mounting only a small window of rows', () => {
    const all: GitLogEntry[] = Array.from({ length: 10_000 }, (_unused, i) =>
      entry({ hash: `hash${i}`, message: `commit-${i}` })
    )
    renderPanel({ all, total: all.length })

    const rendered = screen.queryAllByText(/^commit-\d+$/)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(1000)
    expect(screen.getByText('commit-0')).toBeInTheDocument()
    expect(screen.queryByText('commit-9999')).not.toBeInTheDocument()
  })

  it('marks merge commits (parents.length >= 2) with a merge indicator', () => {
    renderPanel({
      all: [
        entry({
          hash: 'merge1',
          message: 'Merge branch feature',
          parents: ['parentA', 'parentB']
        })
      ],
      total: 1
    })

    expect(screen.getByLabelText('merge commit')).toBeInTheDocument()
  })
})

describe('parseRefs', () => {
  it('drops origin/X when local X is on the same commit', () => {
    const refs = parseRefs('HEAD -> main, origin/main')
    expect(refs).toEqual([{ label: 'main', kind: 'branch' }])
  })

  it('keeps origin/X when no matching local branch is present', () => {
    const refs = parseRefs('origin/feature')
    expect(refs).toEqual([{ label: 'origin/feature', kind: 'remote' }])
  })

  it('classifies stash entries', () => {
    const refs = parseRefs('stash@{0}')
    expect(refs).toEqual([{ label: 'stash@{0}', kind: 'stash' }])
  })

  it('drops origin/HEAD symref so it never renders as a pill', () => {
    const refs = parseRefs('HEAD -> main, origin/main, origin/HEAD', new Set(['origin']))
    expect(refs).toEqual([{ label: 'main', kind: 'branch' }])
  })
})

describe('layoutCommits', () => {
  it('places a single linear chain in lane 0', () => {
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c2'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const { rows, maxLanes } = layoutCommits(commits)

    expect(maxLanes).toBe(1)
    expect(rows.map((r) => r.commitLane)).toEqual([0, 0, 0])
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
    expect(step2.rows.map((r) => r.commitLane)).toEqual(full.rows.map((r) => r.commitLane))
    expect(step2.rows.map((r) => r.outgoing)).toEqual(full.rows.map((r) => r.outgoing))
    expect(step2.rows.map((r) => r.incoming)).toEqual(full.rows.map((r) => r.incoming))
  })

  it('rebuilds from scratch when the cached prefix no longer matches', () => {
    const cached = layoutCommits([entry({ hash: 'x', parents: [] })])
    const fresh = layoutCommits([entry({ hash: 'y', parents: [] })], cached)

    expect(fresh.rows).toHaveLength(1)
    expect(fresh.rows[0].commit.hash).toBe('y')
  })
})
