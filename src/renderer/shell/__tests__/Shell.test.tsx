import {
  LIST_PANE_DEFAULT_WIDTH,
  LIST_PANE_MAX_WIDTH,
  LIST_PANE_MIN_WIDTH
} from '@shared/list-layout'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import { Shell } from '../Shell'

const repoPath = '/home/user/acme'

function renderShell() {
  return render(
    <Shell
      repoPath={repoPath}
      currentBranch="main"
      branchBrowser={{
        repoPath,
        localBranches: ['main'],
        remoteBranches: [],
        tags: []
      }}
      listHeader={<div>list header</div>}
      listBody={<div>commit list</div>}
      detailPane={<div>detail pane</div>}
      statusDock={<div>status dock</div>}
    />
  )
}

function divider() {
  return screen.getByRole('button', { name: 'Resize commit list' })
}

function listColumn() {
  return screen.getByRole('region', { name: 'Commits' })
}

async function drag(to: number, expectedWidth: number) {
  fireEvent.mouseDown(divider(), { clientX: 0 })
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: to }))
  })
  await waitFor(() => expect(listColumn()).toHaveStyle({ width: `${expectedWidth}px` }))
}

function endDrag() {
  act(() => {
    window.dispatchEvent(new MouseEvent('mouseup'))
  })
}

beforeEach(() => {
  vi.mocked(window.electronAPI.getRefTreeToggles).mockResolvedValue([])
  vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(LIST_PANE_DEFAULT_WIDTH)
  vi.mocked(window.electronAPI.setListPaneWidth).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Shell four-column layout', () => {
  it('shows the refs, commit list, and detail columns at once with a status dock underneath', async () => {
    renderShell()

    expect(screen.getByRole('complementary', { name: 'Branches' })).toBeInTheDocument()
    expect(listColumn()).toBeInTheDocument()
    expect(screen.getByText('list header')).toBeInTheDocument()
    expect(screen.getByText('commit list')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByText('detail pane')).toBeInTheDocument()
    expect(screen.getByText('status dock')).toBeInTheDocument()
    expect(divider()).toBeInTheDocument()
    await waitFor(() => expect(window.electronAPI.getListPaneWidth).toHaveBeenCalledWith(repoPath))
  })

  it('threads branch freshness through to the refs sidebar rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'))
    render(
      <Shell
        repoPath={repoPath}
        currentBranch="main"
        branchBrowser={{
          repoPath,
          localBranches: ['main'],
          remoteBranches: [],
          tags: [],
          lastCommitAt: { main: '2026-08-01T10:00:00Z' }
        }}
        listHeader={<div>list header</div>}
        listBody={<div>commit list</div>}
        detailPane={<div>detail pane</div>}
        statusDock={<div>status dock</div>}
      />
    )

    await waitFor(() => expect(screen.getByTestId('ref-freshness')).toHaveTextContent('2h ago'))
    vi.useRealTimers()
  })

  it('offers no view switcher, because both surfaces are on screen', () => {
    renderShell()

    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Local changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show branches' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide branches' })).not.toBeInTheDocument()
  })

  it('applies the persisted commit-list width', async () => {
    vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(520)
    renderShell()

    await waitFor(() => expect(listColumn()).toHaveStyle({ width: '520px' }))
  })

  it('clamps a persisted width that falls outside the allowed range', async () => {
    vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(9000)
    const wide = renderShell()
    await waitFor(() => expect(listColumn()).toHaveStyle({ width: `${LIST_PANE_MAX_WIDTH}px` }))
    wide.unmount()

    vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(10)
    renderShell()

    await waitFor(() => expect(listColumn()).toHaveStyle({ width: `${LIST_PANE_MIN_WIDTH}px` }))
  })

  it('clamps the drag at both ends and saves the clamped width when the drag ends', async () => {
    renderShell()
    await waitFor(() => expect(listColumn()).toHaveStyle({ width: '400px' }))

    await drag(9000, LIST_PANE_MAX_WIDTH)
    endDrag()

    await waitFor(() =>
      expect(window.electronAPI.setListPaneWidth).toHaveBeenLastCalledWith(
        repoPath,
        LIST_PANE_MAX_WIDTH
      )
    )

    await drag(-9000, LIST_PANE_MIN_WIDTH)
    endDrag()

    await waitFor(() =>
      expect(window.electronAPI.setListPaneWidth).toHaveBeenLastCalledWith(
        repoPath,
        LIST_PANE_MIN_WIDTH
      )
    )
  })

  it('shows the live width beside the handle only while the divider is being dragged', async () => {
    renderShell()
    await waitFor(() => expect(listColumn()).toHaveStyle({ width: '400px' }))
    expect(screen.queryByTestId('list-pane-width-tooltip')).not.toBeInTheDocument()

    await drag(120, 520)

    expect(screen.getByTestId('list-pane-width-tooltip')).toHaveTextContent('520px')

    endDrag()

    expect(screen.queryByTestId('list-pane-width-tooltip')).not.toBeInTheDocument()
  })

  it('returns the commit list to its default width on a double-click of the divider', async () => {
    vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(700)
    renderShell()
    await waitFor(() => expect(listColumn()).toHaveStyle({ width: '700px' }))

    fireEvent.doubleClick(divider())

    expect(listColumn()).toHaveStyle({ width: `${LIST_PANE_DEFAULT_WIDTH}px` })
    await waitFor(() =>
      expect(window.electronAPI.setListPaneWidth).toHaveBeenLastCalledWith(
        repoPath,
        LIST_PANE_DEFAULT_WIDTH
      )
    )
  })

  it('returns the commit list to its default width when the layout is reset', async () => {
    vi.mocked(window.electronAPI.getListPaneWidth).mockResolvedValue(700)
    renderShell()
    await waitFor(() => expect(listColumn()).toHaveStyle({ width: '700px' }))

    act(() => {
      window.dispatchEvent(new Event(LAYOUT_RESET_EVENT))
    })

    expect(listColumn()).toHaveStyle({ width: `${LIST_PANE_DEFAULT_WIDTH}px` })
  })
})
