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
