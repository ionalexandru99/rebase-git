import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TabDescriptor } from '../../hooks/useTabs'
import { RepoRail } from '../RepoRail'

const baseTabs: TabDescriptor[] = [
  { id: 'a', title: 'my-app', hasRepo: true, repoPath: '/dev/my-app' },
  { id: 'b', title: 'web-app', hasRepo: true, repoPath: '/dev/web-app' }
]

describe('RepoRail', () => {
  it('renders an avatar tab per repo plus a new-tab button', () => {
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByText('MA')).toBeInTheDocument()
    expect(screen.getByText('WA')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
  })

  it('fits its avatars inside a 44px rail', () => {
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    expect(screen.getByRole('navigation', { name: 'Open repositories' })).toHaveStyle({
      width: '44px'
    })
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveStyle({ width: '34px', height: '34px' })
    }
    expect(screen.getByRole('button', { name: /Open new tab/i })).toHaveStyle({
      width: '34px',
      height: '34px'
    })
  })

  it('marks the active tab with aria-selected', () => {
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="b"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('invokes onSelect when an avatar is clicked', () => {
    const onSelect = vi.fn()
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="a"
        onSelect={onSelect}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'web-app' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('invokes onClose when a close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={onClose}
        onNew={vi.fn()}
      />
    )

    const closeButtons = screen.getAllByRole('button', { name: /Close tab/i })
    fireEvent.click(closeButtons[1])
    expect(onClose).toHaveBeenCalledWith('b')
  })

  it('creates a new tab from the plus button when no blank tab exists', () => {
    const onNew = vi.fn()
    render(
      <RepoRail
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={onNew}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('activates an existing blank tab instead of creating another', () => {
    const onNew = vi.fn()
    const onSelect = vi.fn()
    render(
      <RepoRail
        tabs={[...baseTabs, { id: 'blank', title: 'New tab', hasRepo: false, repoPath: null }]}
        activeTabId="a"
        onSelect={onSelect}
        onClose={vi.fn()}
        onNew={onNew}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(onSelect).toHaveBeenCalledWith('blank')
    expect(onNew).not.toHaveBeenCalled()
  })
})
