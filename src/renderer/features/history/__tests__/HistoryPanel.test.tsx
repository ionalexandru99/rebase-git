import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { refBadgeColor } from '@/features/history/ref-colors'
import { refFilterKey } from '@/features/history/selectors'
import type { GitLogEntry } from '@/types'
import { statusResponse } from '../../../../test/builders'
import { resizeObserverMock, sidecarMock } from '../../../../test/setup'
import { historyEntry as entry, lastCanvasProps, renderPanel } from './history-panel-test-harness'

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
})
