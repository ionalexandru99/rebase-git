import { fireEvent, render, screen } from '@solidjs/testing-library'
import { describe, expect, it } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { parseRefs } from '@/lib/git-graph/refs'
import type { GitLog, GitLogEntry } from '@/types'
import { HistoryPanel } from '../HistoryPanel'

interface PanelOptions {
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  visibleBranchRefs?: ReadonlySet<string>
  remoteBranches?: string[]
  repoPath?: string
  currentBranch?: string
}

function renderPanel(log: GitLog | null, options: PanelOptions = {}) {
  const visibleBranchRefs =
    options.visibleBranchRefs ??
    new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])

  return render(() => (
    <HistoryPanel
      log={log}
      loading={options.loading ?? false}
      hasMore={options.hasMore}
      onLoadMore={options.onLoadMore}
      visibleBranchRefs={visibleBranchRefs}
      remoteBranches={options.remoteBranches ?? ['origin/main']}
      repoPath={options.repoPath}
      currentBranch={options.currentBranch}
    />
  ))
}

function entry(overrides: Partial<GitLogEntry> & Pick<GitLogEntry, 'hash'>): GitLogEntry {
  return {
    message: 'msg',
    author_name: 'Jane Doe',
    date: new Date().toISOString(),
    parents: [],
    refs: 'main',
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

    expect(screen.getByText('2 commits · 1 branch visible')).toBeInTheDocument()
    expect(screen.getByText('Add support for sparse checkouts')).toBeInTheDocument()
    expect(screen.getByText('Refactor commit panel')).toBeInTheDocument()
    expect(screen.getByText('1234567')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('uses singular copy for one commit', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'one', author_name: 'Solo' })],
        total: 1
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.getByText('1 commit · 1 branch visible')).toBeInTheDocument()
  })

  it('shows the loading badge', () => {
    renderPanel({ all: [], total: 0 }, { loading: true })

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('shows streamed commits without skeleton while history is still loading', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'first streamed commit' })],
        total: 1
      },
      { loading: true }
    )

    expect(screen.getByText('first streamed commit')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading commit history')).not.toBeInTheDocument()
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

    expect(screen.getByTitle('main')).toBeInTheDocument()
    expect(screen.getByTitle('origin/main')).toBeInTheDocument()
    expect(screen.getByText('v1.0')).toBeInTheDocument()
  })

  it('keeps the remote ref when no local branch is at the same SHA', () => {
    renderPanel(
      {
        all: [
          entry({
            hash: 'aaa',
            message: 'tip',
            refs: 'origin/feature'
          })
        ],
        total: 1
      },
      {
        visibleBranchRefs: new Set([refFilterKey('remote', 'origin/feature')])
      }
    )

    expect(screen.getByTitle('origin/feature')).toBeInTheDocument()
    expect(screen.getByText('feature')).toBeInTheDocument()
  })

  it('virtualizes a large history, mounting only a small window of rows', () => {
    const all: GitLogEntry[] = Array.from({ length: 10_000 }, (_unused, index) =>
      entry({
        hash: `hash${index}`,
        message: `commit-${index}`,
        parents: index < 9_999 ? [`hash${index + 1}`] : [],
        refs: index === 0 ? 'main' : ''
      })
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

  it('hides commits outside visible branches', () => {
    renderPanel(
      {
        all: [
          entry({ hash: 'f1', message: 'feature tip', refs: 'feature', parents: ['base'] }),
          entry({ hash: 'm1', message: 'main tip', refs: 'main', parents: ['base'] }),
          entry({ hash: 'base', message: 'shared base', parents: [] })
        ],
        total: 3
      },
      {
        visibleBranchRefs: new Set([refFilterKey('local', 'feature')]),
        remoteBranches: []
      }
    )

    expect(screen.getByText('2 commits · 1 branch visible')).toBeInTheDocument()
    expect(screen.getByText('feature tip')).toBeInTheDocument()
    expect(screen.getByText('shared base')).toBeInTheDocument()
    expect(screen.queryByText('main tip')).not.toBeInTheDocument()
  })

  it('keeps the same commit count when adding a branch already on main', () => {
    const log = {
      all: [
        entry({ hash: 'm1', message: 'main tip', refs: 'main, origin/main', parents: ['f1'] }),
        entry({ hash: 'f1', message: 'feature tip', refs: 'feature', parents: ['base'] }),
        entry({ hash: 'base', message: 'shared base', parents: [] })
      ],
      total: 3
    }
    renderPanel(log, {
      visibleBranchRefs: new Set([
        refFilterKey('local', 'main'),
        refFilterKey('remote', 'origin/main'),
        refFilterKey('local', 'feature')
      ])
    })
    expect(screen.getByText('3 commits · 2 branches visible')).toBeInTheDocument()
  })

  it('dims commits that are not reachable from the current local branch', () => {
    renderPanel(
      {
        all: [
          entry({
            hash: 'feature-tip',
            message: 'feature tip',
            refs: 'feature',
            parents: ['base']
          }),
          entry({ hash: 'main-tip', message: 'main tip', refs: 'HEAD -> main', parents: ['base'] }),
          entry({ hash: 'base', message: 'shared base', refs: '', parents: [] })
        ],
        total: 3
      },
      {
        currentBranch: 'main',
        visibleBranchRefs: new Set([
          refFilterKey('local', 'main'),
          refFilterKey('local', 'feature')
        ]),
        remoteBranches: []
      }
    )

    expect(screen.getByText('feature tip').closest('[style*="opacity"]')).toHaveStyle({
      opacity: '0.6'
    })
    expect(screen.getByText('main tip').closest('[style*="opacity"]')).toHaveStyle({
      opacity: '1'
    })
  })

  it('shows more-available copy when additional history can be loaded', () => {
    renderPanel(
      {
        all: [entry({ hash: 'a', message: 'first' }), entry({ hash: 'b', message: 'second' })],
        total: 2
      },
      { hasMore: true, onLoadMore: () => {} }
    )

    expect(screen.getByText(/more available/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
  })

  it('restores the previous scroll position for a repo', () => {
    const log = {
      all: Array.from({ length: 200 }, (_unused, index) =>
        entry({
          hash: `scroll${index}`,
          message: `scroll-${index}`,
          parents: index < 199 ? [`scroll${index + 1}`] : [],
          refs: index === 0 ? 'main' : ''
        })
      ),
      total: 200
    }
    const first = renderPanel(log, { repoPath: '/repo/scroll' })
    const scroller = screen.getByTestId('history-scroll')
    scroller.scrollTop = 320
    fireEvent.scroll(scroller)
    first.unmount()

    renderPanel(log, { repoPath: '/repo/other' }).unmount()
    renderPanel(log, { repoPath: '/repo/scroll' })

    expect(screen.getByTestId('history-scroll').scrollTop).toBe(320)
  })
})

describe('parseRefs', () => {
  it('keeps local and origin when both decorate the same commit', () => {
    const refs = parseRefs('HEAD -> main, origin/main')
    expect(refs).toEqual([
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ])
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
    expect(refs).toEqual([
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ])
  })
})
