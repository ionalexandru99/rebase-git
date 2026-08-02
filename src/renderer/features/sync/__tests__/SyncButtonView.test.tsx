import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SyncButtonView } from '../SyncButtonView'

function renderView(overrides: Partial<Parameters<typeof SyncButtonView>[0]> = {}) {
  const onSync = overrides.onSync ?? vi.fn()
  const onForcePush = overrides.onForcePush ?? vi.fn()
  render(
    <SyncButtonView
      ahead={overrides.ahead ?? 0}
      behind={overrides.behind ?? 0}
      detached={overrides.detached ?? false}
      syncing={overrides.syncing ?? false}
      disabled={overrides.disabled}
      onSync={onSync}
      onForcePush={onForcePush}
      dialogs={overrides.dialogs}
    />
  )
  return { onSync, onForcePush }
}

const syncButton = () => screen.getByTestId('sync-button')

describe('SyncButtonView', () => {
  it('labels how far the branch is behind and ahead', () => {
    renderView({ ahead: 3, behind: 2 })

    expect(syncButton()).toHaveTextContent('Sync')
    expect(syncButton()).toHaveTextContent('↓2')
    expect(syncButton()).toHaveTextContent('↑3')
  })

  it('drops the arrows when the branch is level with its upstream', () => {
    renderView()

    expect(syncButton().textContent).toBe('Sync')
  })

  it('reports primary and force-push intent without owning either flow', async () => {
    const { onSync, onForcePush } = renderView({ ahead: 1 })

    fireEvent.click(syncButton())
    fireEvent.click(screen.getByRole('button', { name: /sync options/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /force push \(with lease\)/i }))

    expect(onSync).toHaveBeenCalledOnce()
    expect(onForcePush).toHaveBeenCalledOnce()
  })

  it('stays inert while a sync is already running', () => {
    const { onSync } = renderView({ ahead: 1, syncing: true })

    fireEvent.click(syncButton())

    expect(syncButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: /sync options/i })).toBeDisabled()
    expect(onSync).not.toHaveBeenCalled()
  })
})
