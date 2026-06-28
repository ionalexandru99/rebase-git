import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Topbar } from '../Topbar'

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  return render(
    <Topbar
      repoName={overrides.repoName ?? 'my-repo'}
      repoPath={'repoPath' in overrides ? (overrides.repoPath ?? null) : '/home/user/my-repo'}
      activeView={overrides.activeView ?? 'history'}
      onSelectView={overrides.onSelectView ?? vi.fn()}
      workspaceContext={overrides.workspaceContext}
      onFetch={overrides.onFetch}
      onPull={overrides.onPull}
      onPush={overrides.onPush}
      pulling={overrides.pulling}
      pushing={overrides.pushing}
    />
  )
}

describe('Topbar', () => {
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

  it('shows the workspace context when provided', () => {
    renderTopbar({ workspaceContext: 'Fetched 3m ago' })
    expect(screen.getByText('Fetched 3m ago')).toBeInTheDocument()
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

  it('fires onPush when Push is clicked', () => {
    const onPush = vi.fn()
    renderTopbar({ onPush })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('disables Pull and Push while in flight', () => {
    const onPull = vi.fn()
    const onPush = vi.fn()
    renderTopbar({ onPull, onPush, pulling: true, pushing: true })
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    expect(onPull).not.toHaveBeenCalled()
    expect(onPush).not.toHaveBeenCalled()
  })
})
