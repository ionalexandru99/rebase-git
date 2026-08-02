import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ReactElement, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient, QueryProvider } from '@/app/QueryProvider'
import { parseRefs } from '@/features/history/graph/refs'
import { refBadgeColor } from '@/features/history/ref-colors'
import {
  collectTimelineTips,
  computeBranchFilterSet,
  computeCollapsedView,
  refFilterKey
} from '@/features/history/selectors'
import type { GitLog, GitLogEntry } from '@/types'
import { statusResponse } from '../../../../test/builders'
import { resizeObserverMock, sidecarMock } from '../../../../test/setup'
import { HistoryPanel } from '..'
import { createHistoryEntryBuilder } from './fixtures'

const canvasRender = vi.hoisted(() => vi.fn())

vi.mock('@/features/history/CommitGraphCanvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/history/CommitGraphCanvas')>()
  return {
    CommitGraphCanvas: (props: Parameters<typeof actual.CommitGraphCanvas>[0]) => {
      canvasRender(props)
      return actual.CommitGraphCanvas(props)
    }
  }
})

function lastCanvasProps() {
  return canvasRender.mock.lastCall?.[0] as {
    metrics: { rowHeight: number }
    paddingStart?: number
    headRow?: number
  }
}

interface PanelOptions {
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  visibleBranchRefs?: ReadonlySet<string>
  remoteBranches?: string[]
  repoPath?: string
  currentBranch?: string
  onSelectWorkingCopy?: () => void
  workingCopySelected?: boolean
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

function withQuery(ui: ReactElement) {
  return (
    <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
      {ui}
    </QueryProvider>
  )
}

function renderPanel(log: GitLog | null, options: PanelOptions = {}) {
  const visibleBranchRefs =
    options.visibleBranchRefs ??
    new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
  const remoteBranches = options.remoteBranches ?? ['origin/main']

  return render(
    withQuery(
      <HistoryPanel
        log={log}
        loading={options.loading ?? false}
        hasMore={options.hasMore}
        onLoadMore={options.onLoadMore}
        filteredCommits={filterCommits(log, visibleBranchRefs, remoteBranches)}
        repoPath={options.repoPath}
        currentBranch={options.currentBranch}
        onSelectWorkingCopy={options.onSelectWorkingCopy}
        workingCopySelected={options.workingCopySelected}
      />
    )
  )
}

const entry = createHistoryEntryBuilder({
  message: 'msg',
  author_name: 'Jane Doe',
  date: new Date().toISOString(),
  refs: 'main'
})

describe('HistoryPanel', () => {
  it('shows the empty state when there are no commits', () => {
    renderPanel({ all: [], loadedCount: 0 })

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
    expect(screen.getByText(/Make your first commit/)).toBeInTheDocument()
  })

  it('keeps the working copy reachable while the timeline is still empty', () => {
    renderPanel({ all: [], loadedCount: 0 })

    expect(screen.getByText('No commits yet')).toBeInTheDocument()
    expect(screen.getByTestId('working-copy-row')).toBeInTheDocument()
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

    expect(screen.getByText('Add support for sparse checkouts')).toBeInTheDocument()
    expect(screen.getByText('Refactor commit panel')).toBeInTheDocument()
    expect(screen.getByText('1234567')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('AS')).toBeInTheDocument()
  })

  it('re-pitches its rows when its own container crosses a mode boundary', () => {
    renderPanel(
      { all: [entry({ hash: 'aaa', message: 'only commit' })], loadedCount: 1 },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.getByTestId('commit-row')).toHaveStyle({ height: '44px' })

    resizeObserverMock.setContentRect({ width: 900 })

    expect(screen.getByTestId('commit-row')).toHaveStyle({ height: '30px' })
  })

  it('fills in the churn counts for the rows on screen', async () => {
    sidecarMock.getCommitStats.mockResolvedValue({
      _tag: 'Ok',
      stats: [{ sha: 'aaa', additions: 7, deletions: 2 }]
    })

    renderPanel(
      { all: [entry({ hash: 'aaa', message: 'only commit' })], loadedCount: 1 },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]), repoPath: '/repo/churn' }
    )

    expect(await screen.findByText('+7')).toBeInTheDocument()
    expect(screen.getByText('−2')).toBeInTheDocument()
    expect(sidecarMock.getCommitStats).toHaveBeenCalledWith('/repo/churn', ['aaa'])
  })

  it('pins a working-copy row above the first commit at a fixed height in every mode', () => {
    renderPanel(
      { all: [entry({ hash: 'aaa', message: 'only commit' })], loadedCount: 1 },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.getByTestId('working-copy-row')).toHaveStyle({ height: '44px' })
    expect(screen.getByTestId('commit-row')).toHaveStyle({ top: '44px' })

    resizeObserverMock.setContentRect({ width: 900 })

    expect(screen.getByTestId('working-copy-row')).toHaveStyle({ height: '44px' })
    expect(screen.getByTestId('commit-row')).toHaveStyle({ top: '44px' })
  })

  it('reads the working tree onto the pinned row', async () => {
    sidecarMock.getStatus.mockResolvedValue(
      statusResponse({
        files: [
          { path: 'a.ts', index: 'M', working_dir: ' ' },
          { path: 'b.ts', index: ' ', working_dir: 'M' },
          { path: 'c.ts', index: '?', working_dir: '?' }
        ]
      })
    )
    sidecarMock.getWorkingTreeStats.mockResolvedValue({ _tag: 'Ok', additions: 12, deletions: 4 })

    renderPanel(
      { all: [entry({ hash: 'aaa', message: 'only commit' })], loadedCount: 1 },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]), repoPath: '/repo/wc' }
    )

    expect(await screen.findByText('1 staged · 2 unstaged')).toBeInTheDocument()
    expect(screen.getByTestId('working-copy-churn')).toHaveTextContent('+12')
    expect(screen.getByTestId('working-copy-churn')).toHaveTextContent('−4')
  })

  it('hands the working copy to its owner when clicked', () => {
    const onSelectWorkingCopy = vi.fn()
    renderPanel(
      { all: [entry({ hash: 'aaa', message: 'only commit' })], loadedCount: 1 },
      {
        visibleBranchRefs: new Set([refFilterKey('local', 'main')]),
        onSelectWorkingCopy,
        workingCopySelected: true
      }
    )

    const pinned = screen.getByTestId('working-copy-row')
    expect(pinned).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(pinned)

    expect(onSelectWorkingCopy).toHaveBeenCalledTimes(1)
  })

  it('hands the graph the same pitch as the rows, offset by the pinned row', () => {
    renderPanel(
      {
        all: [
          entry({ hash: 'aaa', message: 'tip', refs: 'HEAD -> main', parents: ['bbb'] }),
          entry({ hash: 'bbb', message: 'root', refs: '' })
        ],
        loadedCount: 2
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(lastCanvasProps().metrics.rowHeight).toBe(44)
    expect(lastCanvasProps().paddingStart).toBe(44)
    expect(lastCanvasProps().headRow).toBe(0)

    resizeObserverMock.setContentRect({ width: 900 })

    expect(screen.getAllByTestId('commit-row')[0]).toHaveStyle({ height: '30px' })
    expect(lastCanvasProps().metrics.rowHeight).toBe(30)
    expect(lastCanvasProps().paddingStart).toBe(44)
  })

  it('keeps the topmost commit anchored when the pitch changes under it', () => {
    renderPanel(
      {
        all: Array.from({ length: 200 }, (_unused, index) =>
          entry({
            hash: `anchor${index}`,
            message: `anchor-${index}`,
            parents: index < 199 ? [`anchor${index + 1}`] : [],
            refs: index === 0 ? 'main' : ''
          })
        ),
        loadedCount: 200
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]), repoPath: '/repo/anchor' }
    )
    const scroller = screen.getByTestId('history-scroll')
    scroller.scrollTop = 44 + 44 * 10
    fireEvent.scroll(scroller)

    resizeObserverMock.setContentRect({ width: 900 })

    expect(screen.getByTestId('history-scroll').scrollTop).toBe(44 + 30 * 10)
  })

  it('carries its columns in the rows themselves, with no header strip above them', () => {
    renderPanel(
      {
        all: [entry({ hash: 'abcdef1234567890', message: 'only commit' })],
        loadedCount: 1
      },
      { visibleBranchRefs: new Set([refFilterKey('local', 'main')]) }
    )

    expect(screen.queryByText('Author')).not.toBeInTheDocument()
    expect(screen.queryByText('SHA')).not.toBeInTheDocument()
    expect(screen.queryByText('Date')).not.toBeInTheDocument()
    expect(screen.getByTestId('commit-row')).toHaveTextContent('abcdef1')
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

  it('tints every ref badge by its own branch name, so co-located refs stay distinct', () => {
    renderPanel({
      all: [
        entry({
          hash: 'aaa',
          message: 'tip commit',
          refs: `HEAD -> main${GIT_LOG_REF_SEPARATOR}feature/streaming`
        })
      ],
      loadedCount: 1
    })

    const mainColor = refBadgeColor('main')
    const streamingColor = refBadgeColor('feature/streaming', [mainColor])
    expect(screen.getByTitle('main')).toHaveStyle({ color: mainColor })
    expect(screen.getByTitle('feature/streaming')).toHaveStyle({ color: streamingColor })
    expect(mainColor).not.toBe(streamingColor)
  })

  it('sheds row detail as its container narrows, one mode at a time', () => {
    renderPanel({
      all: [
        entry({
          hash: 'abcdef1234567890',
          author_name: 'Jane Doe',
          message: 'tip commit',
          refs: 'main'
        })
      ],
      loadedCount: 1
    })

    resizeObserverMock.setContentRect({ width: 900 })
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()

    resizeObserverMock.setContentRect({ width: 560 })
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
    expect(screen.getByText('JD')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()

    resizeObserverMock.setContentRect({ width: 100 })
    expect(screen.queryByText('tip commit')).not.toBeInTheDocument()
    expect(screen.queryByText('abcdef1')).not.toBeInTheDocument()
    expect(screen.getByTestId('commit-row')).toBeInTheDocument()
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

    expect(screen.getAllByTestId('commit-row')).toHaveLength(2)
    expect(screen.getByText('feature tip')).toBeInTheDocument()
    expect(screen.getByText('shared base')).toBeInTheDocument()
    expect(screen.queryByText('main tip')).not.toBeInTheDocument()
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

  it('offers a Load more affordance inline at the bottom of the list', () => {
    renderPanel(
      {
        all: [entry({ hash: 'a', message: 'first' }), entry({ hash: 'b', message: 'second' })],
        loadedCount: 2
      },
      { hasMore: true, onLoadMore: () => {} }
    )

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
      withQuery(
        <HistoryPanel
          log={second}
          loading={false}
          loadingMore={false}
          hasMore={true}
          onLoadMore={onLoadMore}
          filteredCommits={filterCommits(second, visibleBranchRefs, [])}
          repoPath="/repo/paginated"
        />
      )
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
    const view = render(
      withQuery(
        <HistoryPanel
          log={shortLog}
          loading={true}
          repoPath={repoPath}
          filteredCommits={shortLog.all}
        />
      )
    )
    const clampedScroller = screen.getByTestId('history-scroll')
    clampedScroller.scrollTop = 0

    view.rerender(
      withQuery(
        <HistoryPanel
          log={longLog}
          loading={true}
          repoPath={repoPath}
          filteredCommits={longLog.all}
        />
      )
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
    render(withQuery(<CollapsibleHistory log={mergeLog} />))

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
