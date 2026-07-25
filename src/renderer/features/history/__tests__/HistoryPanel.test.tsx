import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { parseRefs } from '@/features/history/graph/refs'
import {
  collectTimelineTips,
  computeBranchFilterSet,
  computeCollapsedView,
  refFilterKey
} from '@/features/history/selectors'
import type { GitLog, GitLogEntry } from '@/types'
import { HistoryPanel } from '..'

const historyHeaderRender = vi.hoisted(() => vi.fn())

vi.mock('@/features/history/HistoryHeader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/history/HistoryHeader')>()
  return {
    HistoryHeader: (props: Parameters<typeof actual.HistoryHeader>[0]) => {
      historyHeaderRender()
      return actual.HistoryHeader(props)
    }
  }
})

interface PanelOptions {
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  visibleBranchRefs?: ReadonlySet<string>
  remoteBranches?: string[]
  repoPath?: string
  currentBranch?: string
}

function filterCommits(
  log: GitLog | null,
  visibleBranchRefs: ReadonlySet<string>,
  remoteBranches: string[]
): GitLogEntry[] {
  const commits = log?.all ?? []
  if (visibleBranchRefs.size === 0) {
    return []
  }
  const reachable = computeBranchFilterSet(commits, visibleBranchRefs, remoteBranches, new Set())
  if (!reachable) {
    return []
  }
  return commits.filter((commit) => reachable.has(commit.hash))
}

function renderPanel(log: GitLog | null, options: PanelOptions = {}) {
  const visibleBranchRefs =
    options.visibleBranchRefs ??
    new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
  const remoteBranches = options.remoteBranches ?? ['origin/main']

  return render(
    <HistoryPanel
      log={log}
      loading={options.loading ?? false}
      hasMore={options.hasMore}
      onLoadMore={options.onLoadMore}
      visibleBranchRefs={visibleBranchRefs}
      filteredCommits={filterCommits(log, visibleBranchRefs, remoteBranches)}
      remoteBranches={remoteBranches}
      repoPath={options.repoPath}
      currentBranch={options.currentBranch}
    />
  )
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
    renderPanel({ all: [], loadedCount: 0 })

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
      loadedCount: 2
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

  it('renders metadata column headers and drops the Subject column', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'only commit' })],
        loadedCount: 1
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.getByText('Author')).toBeInTheDocument()
    expect(screen.getByText('SHA')).toBeInTheDocument()
    expect(screen.getByText('Date')).toBeInTheDocument()
    expect(screen.queryByText('Subject')).not.toBeInTheDocument()
  })

  it('uses singular copy for one commit', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'one', author_name: 'Solo' })],
        loadedCount: 1
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.getByText('1 commit · 1 branch visible')).toBeInTheDocument()
  })

  it('shows the loading badge', () => {
    renderPanel({ all: [], loadedCount: 0 }, { loading: true })

    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('shows streamed commits without skeleton while history is still loading', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'first streamed commit' })],
        loadedCount: 1
      },
      { loading: true }
    )

    expect(screen.getByText('first streamed commit')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByLabelText('Loading commit history')).not.toBeInTheDocument()
  })

  it('renders branch, remote, and tag decorations from the log protocol', () => {
    renderPanel({
      all: [
        entry({
          hash: 'aaa',
          message: 'tip commit',
          refs: `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main${GIT_LOG_REF_SEPARATOR}tag: v1.0`
        })
      ],
      loadedCount: 1
    })

    expect(screen.getByTitle('main')).toBeInTheDocument()
    expect(screen.getByTitle('origin/main')).toBeInTheDocument()
    expect(screen.getByText('v1.0')).toBeInTheDocument()
  })

  it('uses the graph lane color for visible refs and their commit badges', () => {
    renderPanel({
      all: [
        entry({
          hash: 'aaa',
          message: 'tip commit',
          refs: `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`
        })
      ],
      loadedCount: 1
    })

    const visibleMain = screen.getByText('Visible:').closest('button')
    const mainBadge = screen.getByTitle('main')
    expect(visibleMain).toHaveStyle({ color: '#7c8cff' })
    expect(mainBadge).toHaveStyle({ color: '#7c8cff' })
  })

  it('marks responsive metadata columns so compact history can hide them', () => {
    renderPanel({
      all: [
        entry({
          hash: 'abcdef1234567890',
          date: '2026-07-21T09:42:00.000Z',
          message: 'tip commit',
          refs: 'main'
        })
      ],
      loadedCount: 1
    })

    expect(screen.getByText('SHA')).toHaveAttribute('data-history-column', 'sha')
    expect(screen.getByText('Date')).toHaveAttribute('data-history-column', 'date')
    const commitRow = screen.getByTestId('commit-row')
    expect(commitRow.querySelector('[data-history-column="sha"]')).toHaveTextContent('abcdef1')
    expect(commitRow.querySelector('[data-history-column="date"]')).not.toBeEmptyDOMElement()
  })

  it('nests every responsive column inside the history panel scope', () => {
    const { container } = renderPanel({
      all: [
        entry({
          hash: 'abcdef1234567890',
          date: '2026-07-21T09:42:00.000Z',
          message: 'tip commit',
          refs: 'main'
        })
      ],
      loadedCount: 1
    })

    const panel = container.querySelector('[data-history-panel]')
    expect(panel).not.toBeNull()
    const columns = [...container.querySelectorAll('[data-history-column]')]
    expect(columns.length).toBeGreaterThan(0)
    for (const column of columns) {
      expect(panel?.contains(column)).toBe(true)
    }
  })

  it('leaves refs without a laid out tip uncolored so they stay visually unresolved', () => {
    renderPanel(
      {
        all: [entry({ hash: 'aaa', message: 'tip commit', refs: 'main' })],
        loadedCount: 1
      },
      {
        visibleBranchRefs: new Set([
          refFilterKey('local', 'main'),
          refFilterKey('local', 'not-loaded')
        ]),
        remoteBranches: []
      }
    )

    const unresolved = screen.getByText('not-loaded').closest('button')
    expect(unresolved?.style.color).toBe('var(--muted-foreground)')
    const resolved = screen.getByText('Visible:').closest('button')
    expect(resolved).toHaveStyle({ color: '#7c8cff' })
  })

  it('renders complete branch and tag badges when their names contain commas', () => {
    renderPanel(
      {
        all: [
          entry({
            hash: 'aaa',
            message: 'tip commit',
            refs: `HEAD -> release,2026${GIT_LOG_REF_SEPARATOR}tag: v1,stable`
          })
        ],
        loadedCount: 1
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'release,2026')]) }
    )

    expect(screen.getByTitle('release,2026')).toBeInTheDocument()
    expect(screen.getByText('v1,stable')).toBeInTheDocument()
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
        loadedCount: 1
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
    renderPanel({ all, loadedCount: all.length })

    const rendered = screen.queryAllByText(/^commit-\d+$/)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThanOrEqual(50)
    expect(screen.getByText('commit-0')).toBeInTheDocument()
    expect(screen.queryByText('commit-9999')).not.toBeInTheDocument()
  })

  it('does not rerender the full panel header on scroll', () => {
    const all = Array.from({ length: 500 }, (_unused, index) =>
      entry({
        hash: `render-${index}`,
        message: `render-${index}`,
        parents: index < 499 ? [`render-${index + 1}`] : [],
        refs: index === 0 ? 'main' : ''
      })
    )
    renderPanel({ all, loadedCount: all.length })
    const scroller = screen.getByTestId('history-scroll')
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 320 })
    historyHeaderRender.mockClear()

    scroller.scrollTop = 640
    fireEvent.scroll(scroller)

    expect(historyHeaderRender).not.toHaveBeenCalled()
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
      loadedCount: 1
    })

    expect(screen.getByText('Merge commit with 2 parents')).toBeInTheDocument()
  })

  it('hides commits outside visible branches', () => {
    renderPanel(
      {
        all: [
          entry({ hash: 'f1', message: 'feature tip', refs: 'feature', parents: ['base'] }),
          entry({ hash: 'm1', message: 'main tip', refs: 'main', parents: ['base'] }),
          entry({ hash: 'base', message: 'shared base', parents: [] })
        ],
        loadedCount: 3
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
        entry({
          hash: 'm1',
          message: 'main tip',
          refs: `main${GIT_LOG_REF_SEPARATOR}origin/main`,
          parents: ['f1']
        }),
        entry({ hash: 'f1', message: 'feature tip', refs: 'feature', parents: ['base'] }),
        entry({ hash: 'base', message: 'shared base', parents: [] })
      ],
      loadedCount: 3
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
        loadedCount: 3
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
        loadedCount: 2
      },
      { hasMore: true, onLoadMore: () => {} }
    )

    expect(screen.getByText(/more available/)).toBeInTheDocument()
    expect(screen.getByText(/2 loaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
  })

  it('auto-loads when the selected branch has no visible commits in the loaded page', async () => {
    const onLoadMore = vi.fn()
    renderPanel(
      {
        all: [entry({ hash: 'other', message: 'other branch', refs: 'other' })],
        loadedCount: 1
      },
      {
        hasMore: true,
        onLoadMore,
        visibleBranchRefs: new Set([refFilterKey('local', 'main')]),
        remoteBranches: []
      }
    )

    await waitFor(() => {
      expect(onLoadMore).toHaveBeenCalledTimes(1)
    })
  })

  it('auto-loads each successive page once while the viewport remains near the end', async () => {
    const onLoadMore = vi.fn()
    const first = {
      all: [entry({ hash: 'a', message: 'first', refs: 'main' })],
      loadedCount: 1
    }
    const view = renderPanel(first, {
      hasMore: true,
      onLoadMore,
      repoPath: '/repo/paginated'
    })

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))

    const second = {
      all: [
        entry({ hash: 'a', message: 'first', refs: 'main', parents: ['b'] }),
        entry({ hash: 'b', message: 'second' })
      ],
      loadedCount: 2
    }
    const visibleBranchRefs = new Set([refFilterKey('local', 'main')])
    view.rerender(
      <HistoryPanel
        log={second}
        loading={false}
        loadingMore={false}
        hasMore={true}
        onLoadMore={onLoadMore}
        visibleBranchRefs={visibleBranchRefs}
        filteredCommits={filterCommits(second, visibleBranchRefs, [])}
        remoteBranches={[]}
        repoPath="/repo/paginated"
      />
    )

    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(2))
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
      loadedCount: 200
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

  it('does not overwrite remembered scroll while history is loading', () => {
    const log = {
      all: Array.from({ length: 200 }, (_unused, index) =>
        entry({
          hash: `loading-scroll${index}`,
          message: `loading-scroll-${index}`,
          parents: index < 199 ? [`loading-scroll${index + 1}`] : [],
          refs: index === 0 ? 'main' : ''
        })
      ),
      loadedCount: 200
    }
    const initial = renderPanel(log, { repoPath: '/repo/loading-scroll' })
    const scroller = screen.getByTestId('history-scroll')
    scroller.scrollTop = 320
    fireEvent.scroll(scroller)
    initial.unmount()

    const loading = renderPanel(log, { repoPath: '/repo/loading-scroll', loading: true })
    const loadingScroller = screen.getByTestId('history-scroll')
    loadingScroller.scrollTop = 0
    fireEvent.scroll(loadingScroller)
    loading.unmount()

    renderPanel(log, { repoPath: '/repo/loading-scroll' })
    expect(screen.getByTestId('history-scroll').scrollTop).toBe(320)
  })

  it('retries scroll restoration after streamed content becomes tall enough', () => {
    const repoPath = '/repo/delayed-scroll'
    const longLog = {
      all: Array.from({ length: 200 }, (_unused, index) =>
        entry({
          hash: `delayed${index}`,
          message: `delayed-${index}`,
          parents: index < 199 ? [`delayed${index + 1}`] : [],
          refs: index === 0 ? 'main' : ''
        })
      ),
      loadedCount: 200
    }
    const remembered = renderPanel(longLog, { repoPath })
    const rememberedScroller = screen.getByTestId('history-scroll')
    rememberedScroller.scrollTop = 320
    fireEvent.scroll(rememberedScroller)
    remembered.unmount()

    const shortLog = { all: [longLog.all[0]], loadedCount: 1 }
    const visibleRefs = new Set([refFilterKey('local', 'main')])
    const view = render(
      <HistoryPanel
        log={shortLog}
        loading={true}
        repoPath={repoPath}
        visibleBranchRefs={visibleRefs}
        remoteBranches={[]}
        filteredCommits={shortLog.all}
      />
    )
    const clampedScroller = screen.getByTestId('history-scroll')
    clampedScroller.scrollTop = 0

    view.rerender(
      <HistoryPanel
        log={longLog}
        loading={true}
        repoPath={repoPath}
        visibleBranchRefs={visibleRefs}
        remoteBranches={[]}
        filteredCommits={longLog.all}
      />
    )

    expect(screen.getByTestId('history-scroll').scrollTop).toBe(320)
  })
})

function CollapsibleHistory({ log }: { log: GitLog }) {
  const [expandedMerges, setExpandedMerges] = useState<ReadonlySet<string>>(new Set())
  const allCommits = log.all
  const visibleBranchRefs = new Set([refFilterKey('local', 'main')])
  const tips = collectTimelineTips(allCommits, visibleBranchRefs, [], new Set())
  const displayed = computeCollapsedView(allCommits, tips, expandedMerges)
  const filteredCommits = allCommits.filter((commit) => displayed.has(commit.hash))
  return (
    <HistoryPanel
      log={log}
      loading={false}
      remoteBranches={[]}
      visibleBranchRefs={visibleBranchRefs}
      graphCommits={allCommits}
      timelineTips={tips}
      filteredCommits={filteredCommits}
      displayedCommitSet={displayed}
      expandedMerges={expandedMerges}
      onToggleMergeExpansion={(mergeHash) =>
        setExpandedMerges((previous) => {
          const next = new Set(previous)
          if (next.has(mergeHash)) {
            next.delete(mergeHash)
          } else {
            next.add(mergeHash)
          }
          return next
        })
      }
    />
  )
}

describe('HistoryPanel merge collapse', () => {
  const mergeLog: GitLog = {
    all: [
      entry({ hash: 'm4', message: 'merge tip', refs: 'HEAD -> main', parents: ['m3', 'f2'] }),
      entry({ hash: 'm3', message: 'main-three', refs: '', parents: ['m2'] }),
      entry({ hash: 'f2', message: 'feature-two', refs: '', parents: ['f1'] }),
      entry({ hash: 'f1', message: 'feature-one', refs: '', parents: ['m2'] }),
      entry({ hash: 'm2', message: 'main-two', refs: '', parents: ['m1'] }),
      entry({ hash: 'm1', message: 'main-one', refs: '', parents: [] })
    ],
    loadedCount: 6
  }

  it('hides side-branch commits until the merge dot is expanded, then restores on collapse', () => {
    render(<CollapsibleHistory log={mergeLog} />)

    expect(screen.getAllByTestId('commit-row')).toHaveLength(4)
    expect(screen.queryByText('feature-two')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand merge side branch' }))

    expect(screen.getAllByTestId('commit-row')).toHaveLength(6)
    expect(screen.getByText('feature-two')).toBeInTheDocument()
    expect(screen.getByText('feature-one')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse merge side branch' }))

    expect(screen.getAllByTestId('commit-row')).toHaveLength(4)
    expect(screen.queryByText('feature-two')).not.toBeInTheDocument()
  })
})

describe('parseRefs', () => {
  it('keeps local and origin when both decorate the same commit', () => {
    const refs = parseRefs(`HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`)
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
    const refs = parseRefs(
      `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main${GIT_LOG_REF_SEPARATOR}origin/HEAD`,
      new Set(['origin'])
    )
    expect(refs).toEqual([
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ])
  })
})
