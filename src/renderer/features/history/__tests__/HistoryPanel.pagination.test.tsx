import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { refFilterKey } from '@/features/history/selectors'
import { HistoryPanel } from '..'
import {
  historyEntry as entry,
  filterCommits,
  renderPanel,
  withQuery
} from './history-panel-test-harness'

describe('HistoryPanel pagination and scroll restoration', () => {
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
