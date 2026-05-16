import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TabBar, type TabDescriptor } from '@/components/TabBar'

const baseTabs: TabDescriptor[] = [
  { id: 'a', title: 'my-app', hasRepo: true },
  { id: 'b', title: 'web-app', hasRepo: true }
]

describe('TabBar', () => {
  it('renders the Rebase brand and a new-tab button', () => {
    render(
      <TabBar
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    expect(screen.getByText('Rebase')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open new tab/i })).toBeInTheDocument()
  })

  it('renders each tab as a role="tab" element with the title visible', () => {
    render(
      <TabBar
        tabs={baseTabs}
        activeTabId="a"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(screen.getByText('my-app')).toBeInTheDocument()
    expect(screen.getByText('web-app')).toBeInTheDocument()
  })

  it('marks the active tab with aria-selected', () => {
    render(
      <TabBar
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

  it('invokes onSelect when a tab is clicked', () => {
    const onSelect = vi.fn()
    render(
      <TabBar
        tabs={baseTabs}
        activeTabId="a"
        onSelect={onSelect}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText('web-app'))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('invokes onClose when a close button is clicked', () => {
    const onClose = vi.fn()
    render(
      <TabBar
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

  it('invokes onNew when the plus button is clicked', () => {
    const onNew = vi.fn()
    render(
      <TabBar tabs={baseTabs} activeTabId="a" onSelect={vi.fn()} onClose={vi.fn()} onNew={onNew} />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open new tab/i }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('hides all close buttons when only one tab is open', () => {
    render(
      <TabBar
        tabs={[{ id: 'only', title: 'My Tab', hasRepo: true }]}
        activeTabId="only"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    expect(screen.queryAllByRole('button', { name: /Close tab/i })).toHaveLength(0)
  })

  it('shows the title in italics for tabs without a repo', () => {
    render(
      <TabBar
        tabs={[{ id: 'x', title: 'New tab', hasRepo: false }]}
        activeTabId="x"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />
    )

    const label = screen.getByText('New tab')
    expect(label.className).toMatch(/italic/)
  })
})
