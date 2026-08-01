import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushOutcome } from '@/stores/action-runner'
import { SyncButton } from '../SyncButton'

const ok: PushOutcome = { kind: 'ok' }

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

function renderSync(overrides: Partial<Parameters<typeof SyncButton>[0]> = {}) {
  const calls: string[] = []
  const onPull = vi.fn(async () => {
    calls.push('pull')
    return true
  })
  const onFetch = vi.fn(() => {
    calls.push('fetch')
  })
  const push = vi.fn(async () => {
    calls.push('push')
    return ok
  })
  render(
    <SyncButton
      branchName={overrides.branchName ?? 'main'}
      ahead={overrides.ahead ?? 0}
      behind={overrides.behind ?? 0}
      detached={overrides.detached ?? false}
      syncing={overrides.syncing ?? false}
      disabled={overrides.disabled}
      onPull={overrides.onPull ?? onPull}
      onFetch={overrides.onFetch ?? onFetch}
      push={overrides.push ?? push}
    />
  )
  return { calls, onPull, onFetch, push }
}

const syncButton = () => screen.getByTestId('sync-button')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SyncButton', () => {
  it('labels how far the branch is behind and ahead', () => {
    renderSync({ ahead: 3, behind: 2 })

    expect(syncButton()).toHaveTextContent('Sync')
    expect(syncButton()).toHaveTextContent('↓2')
    expect(syncButton()).toHaveTextContent('↑3')
  })

  it('drops the arrows when the branch is level with its upstream', () => {
    renderSync({ ahead: 0, behind: 0 })

    expect(syncButton().textContent).toBe('Sync')
  })

  it('fetches when there is nothing to pull or push', async () => {
    const { calls } = renderSync({ ahead: 0, behind: 0 })

    fireEvent.click(syncButton())

    await waitFor(() => expect(calls).toEqual(['fetch']))
  })

  it('pulls only when the branch is behind', async () => {
    const { calls } = renderSync({ ahead: 0, behind: 2 })

    fireEvent.click(syncButton())

    await waitFor(() => expect(calls).toEqual(['pull']))
  })

  it('pushes only when the branch is ahead', async () => {
    const { calls } = renderSync({ ahead: 2, behind: 0 })

    fireEvent.click(syncButton())

    await waitFor(() => expect(calls).toEqual(['push']))
  })

  it('pulls before pushing when the branch has drifted both ways', async () => {
    const { calls } = renderSync({ ahead: 2, behind: 3 })

    fireEvent.click(syncButton())

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(calls).toEqual(['pull'])
    expect(screen.getByRole('dialog')).toHaveTextContent('2 ahead and 3 behind')
  })

  it('never force-pushes a diverged branch without an explicit confirmation', async () => {
    const { calls } = renderSync({ ahead: 2, behind: 3, onPull: vi.fn(async () => true) })

    fireEvent.click(syncButton())

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(calls).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    await waitFor(() => expect(calls).toEqual(['push']))
  })

  it('stays out of the way while a sync is already running', () => {
    const { calls } = renderSync({ ahead: 1, syncing: true })

    fireEvent.click(syncButton())

    expect(syncButton()).toBeDisabled()
    expect(calls).toEqual([])
  })

  it('keeps a manual leased force reachable behind the caret', async () => {
    const { push } = renderSync({ ahead: 1, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: /sync options/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /force push \(with lease\)/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })
})
