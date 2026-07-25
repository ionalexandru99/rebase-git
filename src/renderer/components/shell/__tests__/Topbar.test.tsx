import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from '../Topbar'

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  return render(
    <Topbar
      repoName={overrides.repoName ?? 'my-repo'}
      repoPath={'repoPath' in overrides ? (overrides.repoPath ?? null) : '/home/user/my-repo'}
      activeView={overrides.activeView ?? 'history'}
      onSelectView={overrides.onSelectView ?? vi.fn()}
      lastFetchedAt={overrides.lastFetchedAt}
      onFetch={overrides.onFetch}
      onPull={overrides.onPull}
      push={overrides.push ?? vi.fn(async () => ({ kind: 'ok' }) as const)}
      branch={overrides.branch ?? 'main'}
      ahead={overrides.ahead}
      behind={overrides.behind}
      detached={overrides.detached}
      pulling={overrides.pulling}
      pushing={overrides.pushing}
      busy={overrides.busy}
      compact={overrides.compact}
      sidebarOpen={overrides.sidebarOpen}
      onToggleSidebar={overrides.onToggleSidebar}
      onResetLayout={overrides.onResetLayout}
    />
  )
}

describe('Topbar', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it('renders the repo name and path', () => {
    renderTopbar({ repoName: 'acme' })
    expect(screen.getByText('acme')).toBeInTheDocument()
    expect(screen.getByText('/home/user/my-repo')).toBeInTheDocument()
  })

  it('hides the repo path when repoPath is null', () => {
    renderTopbar({ repoPath: null })
    expect(screen.queryByText('/home/user/my-repo')).not.toBeInTheDocument()
  })

  it('copies the path and shows feedback when the path is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true
    })
    renderTopbar({ repoPath: '/projects/acme' })

    fireEvent.click(screen.getByRole('button', { name: '/projects/acme' }))

    expect(writeText).toHaveBeenCalledWith('/projects/acme')
    expect(screen.getByText('Copied path')).toBeInTheDocument()
  })

  it('renders History and Local changes view tabs with the active one pressed', () => {
    renderTopbar({ activeView: 'history' })
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Local changes' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('fires onSelectView when a view tab is clicked', () => {
    const onSelectView = vi.fn()
    renderTopbar({ activeView: 'history', onSelectView })
    fireEvent.click(screen.getByRole('button', { name: 'Local changes' }))
    expect(onSelectView).toHaveBeenCalledWith('local-changes')
  })

  it('updates the fetched-relative-time without an unrelated render', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'))
    renderTopbar({ lastFetchedAt: Date.now() })
    expect(screen.getByText('Fetched just now')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(screen.getByText('Fetched 1m ago')).toBeInTheDocument()
  })

  it('fires onFetch when Fetch is clicked', () => {
    const onFetch = vi.fn()
    renderTopbar({ onFetch })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('fires onPull when Pull is clicked', () => {
    const onPull = vi.fn()
    renderTopbar({ onPull })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('toggles the branch sidebar from the toolbar', () => {
    const onToggleSidebar = vi.fn()
    renderTopbar({ sidebarOpen: false, onToggleSidebar })

    fireEvent.click(screen.getByRole('button', { name: 'Show branches' }))

    expect(onToggleSidebar).toHaveBeenCalledOnce()
  })

  it('offers remote actions and layout reset from the repository actions menu', async () => {
    const onFetch = vi.fn()
    const onPull = vi.fn()
    const onResetLayout = vi.fn()
    renderTopbar({ compact: true, onFetch, onPull, onResetLayout })

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(1)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Fetch from remotes' }))
    expect(onFetch).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pull from upstream' }))
    expect(onPull).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Reset layout' }))
    expect(onResetLayout).toHaveBeenCalledOnce()
  })

  it('keeps remote actions inline and out of the repository menu when wide', async () => {
    renderTopbar({ onFetch: vi.fn(), onPull: vi.fn(), onResetLayout: vi.fn() })

    expect(screen.getByRole('button', { name: 'Fetch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pull' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Reset layout' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Fetch from remotes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Pull from upstream' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(0)
  })

  it('hides the repository actions menu when no repository action is available', () => {
    renderTopbar()
    expect(screen.queryByRole('button', { name: 'Repository actions' })).not.toBeInTheDocument()
  })

  it('lists only the repository actions whose handler was provided', async () => {
    renderTopbar({ onResetLayout: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))

    expect(await screen.findByRole('menuitem', { name: 'Reset layout' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Fetch from remotes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Pull from upstream' })).not.toBeInTheDocument()
  })

  it('moves the remote actions into the menu when compact', async () => {
    const onFetch = vi.fn()
    renderTopbar({ compact: true, onFetch, onPull: vi.fn() })

    expect(screen.queryByRole('button', { name: 'Fetch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pull' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Repository actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Fetch from remotes' }))

    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('pushes through the PushControl when Push is clicked on a fast-forwardable branch', () => {
    const push = vi.fn(async () => ({ kind: 'ok' }) as const)
    renderTopbar({ push, ahead: 1, behind: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(push).toHaveBeenCalledOnce()
  })

  it('disables Pull and Push while in flight', () => {
    const onPull = vi.fn()
    const push = vi.fn(async () => ({ kind: 'ok' }) as const)
    renderTopbar({ onPull, push, pulling: true, pushing: true })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(onPull).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('disables every remote action while another repository action is busy', () => {
    const onFetch = vi.fn()
    const onPull = vi.fn()
    const push = vi.fn(async () => ({ kind: 'ok' }) as const)
    renderTopbar({ onFetch, onPull, push, busy: true })

    expect(screen.getByRole('button', { name: 'Fetch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
  })
})
