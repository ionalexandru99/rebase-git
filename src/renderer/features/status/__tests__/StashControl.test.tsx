import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StashControl } from '../StashControl'

function renderControl(
  overrides: Partial<{
    stagedFiles: string[]
    stagedCount: number
    hasChanges: boolean
    busy: boolean
    onStashSelected: (files: string[]) => void
    onStashAll: () => void
    blockedReason: string
  }> = {}
) {
  const onStashSelected = overrides.onStashSelected ?? vi.fn()
  const onStashAll = overrides.onStashAll ?? vi.fn()
  render(
    <StashControl
      stagedFiles={overrides.stagedFiles ?? []}
      stagedCount={overrides.stagedCount ?? overrides.stagedFiles?.length ?? 0}
      hasChanges={overrides.hasChanges ?? true}
      busy={overrides.busy ?? false}
      blockedReason={overrides.blockedReason}
      onStashSelected={onStashSelected}
      onStashAll={onStashAll}
    />
  )
  return { onStashSelected, onStashAll }
}

describe('StashControl', () => {
  it('disables stashing and says why while an operation is parked', () => {
    renderControl({ stagedFiles: ['a.ts'], blockedReason: 'Finish or abort the merge first.' })

    const stash = screen.getByRole('button', { name: /^Stash/ })
    expect(stash).toBeDisabled()
    expect(stash).toHaveAttribute('title', 'Finish or abort the merge first.')
  })

  it('disables the primary button when nothing is staged', () => {
    renderControl({ stagedFiles: [] })
    expect(screen.getByRole('button', { name: /^Stash/ })).toBeDisabled()
  })

  it('stashes the staged files when the primary button is clicked', () => {
    const { onStashSelected } = renderControl({ stagedFiles: ['a.ts', 'b.ts'] })
    fireEvent.click(screen.getByRole('button', { name: /^Stash/ }))
    expect(onStashSelected).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('passes both rename paths while counting the rename as one staged file', () => {
    const { onStashSelected } = renderControl({
      stagedFiles: ['old [source].ts', 'new *.ts'],
      stagedCount: 1
    })

    fireEvent.click(screen.getByRole('button', { name: /^Stash/ }))

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(onStashSelected).toHaveBeenCalledWith(['old [source].ts', 'new *.ts'])
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

  it('disables both stash actions while the repository mutation coordinator is busy', () => {
    const { onStashSelected, onStashAll } = renderControl({
      stagedFiles: ['a.ts'],
      hasChanges: true,
      busy: true
    })

    const stashSelected = screen.getByRole('button', { name: /^Stash/ })
    expect(stashSelected).toBeDisabled()
    fireEvent.click(stashSelected)

    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))
    const stashAll = screen.getByRole('menuitem', { name: 'Stash all changes' })
    expect(stashAll).toBeDisabled()
    fireEvent.click(stashAll)

    expect(onStashSelected).not.toHaveBeenCalled()
    expect(onStashAll).not.toHaveBeenCalled()
  })

  it('closes the menu on an outside pointerdown', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes the menu on Escape', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: 'More stash options' }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
