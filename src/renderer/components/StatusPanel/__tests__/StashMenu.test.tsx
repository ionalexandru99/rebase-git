import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sidecarMock } from '@/../test/setup'
import type { GitActions } from '@/hooks/git/useGitActions'
import { StashMenu } from '../StashMenu'

function makeActions(): GitActions {
  const cache = new Map<string, ReturnType<typeof vi.fn>>()
  return new Proxy({} as GitActions, {
    get: (_target, prop: string) => {
      if (!cache.has(prop)) {
        cache.set(
          prop,
          vi.fn(() => Promise.resolve(true))
        )
      }
      return cache.get(prop)
    }
  })
}

function renderMenu(options: { actions?: GitActions; hasChanges?: boolean } = {}) {
  const actions = options.actions ?? makeActions()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StashMenu repoPath="/repo" actions={actions} hasChanges={options.hasChanges ?? true} />
    </QueryClientProvider>
  )
  return actions
}

describe('StashMenu', () => {
  beforeEach(() => {
    sidecarMock.stashList.mockResolvedValue({
      _tag: 'Ok',
      stashes: [{ index: 0, ref: 'stash@{0}', message: 'wip', branch: 'main' }]
    })
  })

  it('stays closed until the trigger is clicked', () => {
    renderMenu()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens a portaled menu and stashes all changes', () => {
    const actions = makeActions()
    renderMenu({ actions })
    fireEvent.click(screen.getByRole('button', { name: /Stash/ }))
    const item = screen.getByRole('menuitem', { name: 'Stash all changes' })
    expect(item).toBeInTheDocument()
    expect(item.closest('body')).toBe(document.body)
    fireEvent.click(item)
    expect(actions.stashPush).toHaveBeenCalled()
  })

  it('lists existing stashes and pops one', async () => {
    const actions = makeActions()
    renderMenu({ actions })
    fireEvent.click(screen.getByRole('button', { name: /Stash/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Pop: wip' }))
    expect(actions.stashPop).toHaveBeenCalledWith(0)
  })

  it('closes on an outside pointerdown', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /Stash/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows an empty hint when there is nothing to stash', () => {
    sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
    renderMenu({ hasChanges: false })
    fireEvent.click(screen.getByRole('button', { name: /Stash/ }))
    expect(screen.getByText('No changes to stash')).toBeInTheDocument()
  })
})
