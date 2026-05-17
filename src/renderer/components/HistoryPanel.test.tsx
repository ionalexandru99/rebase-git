import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HistoryPanel, layoutCommits, parseRefs } from '@/components/HistoryPanel'
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
          // origin/main should be hidden because local main is on the same SHA
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

    // Remote refs render with a cloud icon + the branch name minus the remote prefix.
    expect(screen.getByTitle('origin/feature')).toBeInTheDocument()
    expect(screen.getByText('feature')).toBeInTheDocument()
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
    // c1 (tip of main) -> c3
    // c2 (tip of feature) -> c3   (older sibling, listed second)
    // c3 (shared ancestor)
    const commits: GitLogEntry[] = [
      entry({ hash: 'c1', parents: ['c3'] }),
      entry({ hash: 'c2', parents: ['c3'] }),
      entry({ hash: 'c3', parents: [] })
    ]

    const { rows, maxLanes } = layoutCommits(commits)

    expect(maxLanes).toBe(2)
    expect(rows[0].commitLane).toBe(0)
    expect(rows[1].commitLane).toBe(1)
    // Both lanes collapse into c3's row.
    expect(rows[2].commitLane).toBe(0)
    expect(rows[2].outgoing).toEqual([])
  })

  it('handles a merge commit by expanding into two outgoing lanes', () => {
    // c1 is a merge of c2 and c3
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
})
