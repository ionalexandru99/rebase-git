import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TabDescriptor } from '../../hooks/useTabs'
import { RepoRail } from '../RepoRail'

const baseTabs: TabDescriptor[] = [
  { id: 'a', title: 'my-app', hasRepo: true, repoPath: '/dev/my-app' },
  { id: 'b', title: 'web-app', hasRepo: true, repoPath: '/dev/web-app' }
]

function renderRail(overrides: Partial<Parameters<typeof RepoRail>[0]> = {}) {
  const onSelect = overrides.onSelect ?? vi.fn()
  const onClose = overrides.onClose ?? vi.fn()
  const onNew = overrides.onNew ?? vi.fn()
  render(
    <RepoRail
      tabs={overrides.tabs ?? baseTabs}
      activeTabId={overrides.activeTabId ?? 'a'}
      onSelect={onSelect}
      onClose={onClose}
      onNew={onNew}
    />
  )
  return { onSelect, onClose, onNew }
}

describe('RepoRail', () => {
  it('renders an avatar tab per repo plus a new-tab button', () => {
    renderRail()

    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByText('MA')).toBeInTheDocument()
    expect(screen.getByText('WA')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
  })

  it('fits its avatars inside a 44px rail', () => {
    renderRail()

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
    renderRail({ activeTabId: 'b' })

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('invokes onSelect when an avatar is clicked', () => {
    const { onSelect } = renderRail()

    fireEvent.click(screen.getByRole('tab', { name: 'web-app' }))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('invokes onClose when a close button is clicked', () => {
    const { onClose } = renderRail()

    const closeButtons = screen.getAllByRole('button', { name: /Close tab/i })
    fireEvent.click(closeButtons[1])
    expect(onClose).toHaveBeenCalledWith('b')
  })

  it('creates a new tab from the plus button when no blank tab exists', () => {
    const { onNew } = renderRail()

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('activates an existing blank tab instead of creating another', () => {
    const { onNew, onSelect } = renderRail({
      tabs: [...baseTabs, { id: 'blank', title: 'New tab', hasRepo: false, repoPath: null }]
    })

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(onSelect).toHaveBeenCalledWith('blank')
    expect(onNew).not.toHaveBeenCalled()
  })
})
