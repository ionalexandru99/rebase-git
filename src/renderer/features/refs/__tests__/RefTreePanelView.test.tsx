import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RefTreePanelView } from '../RefTreePanelView'
import { folderKey } from '../ref-tree'

const defaultProps = {
  localBranches: ['main', 'feature/login'],
  remoteBranches: [],
  tags: [],
  currentBranch: 'main',
  toggles: new Set<string>(),
  onToggleCollapsed: vi.fn()
}

describe('RefTreePanelView', () => {
  it('filters and clears refs without loading persisted state', async () => {
    render(<RefTreePanelView {...defaultProps} localBranches={['main', 'develop']} />)

    const input = screen.getByRole('searchbox', { name: 'Filter refs' })
    fireEvent.change(input, { target: { value: 'main' } })

    await waitFor(() => {
      expect(screen.queryByTitle('develop')).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => {
      expect(screen.getByTitle('develop')).toBeInTheDocument()
    })
    expect(window.electronAPI.getRefTreeToggles).not.toHaveBeenCalled()
  })

  it('reports folder expansion through a typed callback', async () => {
    const onToggleCollapsed = vi.fn()
    render(<RefTreePanelView {...defaultProps} onToggleCollapsed={onToggleCollapsed} />)

    fireEvent.click(screen.getByTitle('feature'))

    await waitFor(() => {
      expect(onToggleCollapsed).toHaveBeenCalledWith(folderKey('local', 'feature'))
    })
  })

  it('forwards leaf interactions without repository state', () => {
    const onCheckoutRef = vi.fn()
    const onToggleTimelineVisibility = vi.fn()
    render(
      <RefTreePanelView
        {...defaultProps}
        visibleTimelineRefs={new Set(['local:main'])}
        onCheckoutRef={onCheckoutRef}
        onToggleTimelineVisibility={onToggleTimelineVisibility}
      />
    )

    fireEvent.doubleClick(screen.getByTitle('main'))
    fireEvent.click(screen.getByRole('button', { name: 'Hide main from timeline' }))

    expect(onCheckoutRef).toHaveBeenCalledWith('local', 'main')
    expect(onToggleTimelineVisibility).toHaveBeenCalledWith('local', 'main')
  })
})
