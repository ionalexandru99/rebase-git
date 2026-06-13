import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StashControl } from '../StashControl'

function renderControl(
  overrides: Partial<{
    stagedFiles: string[]
    hasChanges: boolean
    onStashSelected: (files: string[]) => void
    onStashAll: () => void
  }> = {}
) {
  const onStashSelected = overrides.onStashSelected ?? vi.fn()
  const onStashAll = overrides.onStashAll ?? vi.fn()
  render(
    <StashControl
      stagedFiles={overrides.stagedFiles ?? []}
      hasChanges={overrides.hasChanges ?? true}
      onStashSelected={onStashSelected}
      onStashAll={onStashAll}
    />
  )
  return { onStashSelected, onStashAll }
}

describe('StashControl', () => {
  it('disables the primary button when nothing is staged', () => {
    renderControl({ stagedFiles: [] })
    expect(screen.getByRole('button', { name: /^Stash/ })).toBeDisabled()
  })

  it('stashes the staged files when the primary button is clicked', () => {
    const { onStashSelected } = renderControl({ stagedFiles: ['a.ts', 'b.ts'] })
    fireEvent.click(screen.getByRole('button', { name: /^Stash/ }))
    expect(onStashSelected).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('opens the menu and stashes all changes', () => {
    const { onStashAll } = renderControl({ stagedFiles: [] })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))
    const item = screen.getByRole('menuitem', { name: 'Stash all changes' })
    expect(item.closest('body')).toBe(document.body)
    fireEvent.click(item)
    expect(onStashAll).toHaveBeenCalled()
  })

  it('disables "stash all" when there are no changes', () => {
    renderControl({ stagedFiles: [], hasChanges: false })
    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))
    expect(screen.getByRole('menuitem', { name: 'Stash all changes' })).toBeDisabled()
  })

  it('closes the menu on an outside pointerdown', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
