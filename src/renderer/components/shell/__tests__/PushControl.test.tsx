import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { PushControl } from '../PushControl'

const ok: PushOutcome = { kind: 'ok' }

function renderControl(overrides: Partial<Parameters<typeof PushControl>[0]> = {}) {
  const push = overrides.push ?? vi.fn(async () => ok)
  render(
    <PushControl
      branchName={overrides.branchName ?? 'feature/x'}
      ahead={overrides.ahead ?? 1}
      behind={overrides.behind ?? 0}
      detached={overrides.detached ?? false}
      pushing={overrides.pushing ?? false}
      push={push}
    />
  )
  return { push }
}

describe('PushControl', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('pushes plainly when the branch is fast-forwardable', async () => {
    const { push } = renderControl({ ahead: 2, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith()
  })

  it('opens the Tier 1 confirm instead of pushing when the branch is Diverged', async () => {
    const { push } = renderControl({ branchName: 'feature/x', ahead: 2, behind: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('feature/x')
    expect(dialog).toHaveTextContent(/3 behind|behind.*3/)
    expect(screen.getByRole('button', { name: /force push \(with lease\)/i })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('issues a leased force when the Tier 1 confirm is accepted', async () => {
    const { push } = renderControl({ ahead: 2, behind: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('with-lease'))
  })

  it('opens the Tier 2 escalation with the loss preview when the leased force is refused', async () => {
    const push = vi.fn(async (force?: PushForce): Promise<PushOutcome> => {
      if (force === 'with-lease') {
        return {
          kind: 'rejected',
          reason: 'lease-stale',
          lostCommits: [{ sha: 'abc1234', subject: 'teammate work' }],
          remoteSha: 'abc1234fullsha'
        }
      }
      return ok
    })
    renderControl({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    expect(
      await screen.findByRole('button', { name: /overwrite remote anyway/i })
    ).toBeInTheDocument()
    expect(screen.getByText('teammate work')).toBeInTheDocument()
  })

  it('issues a pinned overwrite to the shown remote tip when the escalation is accepted', async () => {
    const push = vi.fn(async (force?: PushForce): Promise<PushOutcome> => {
      if (force === 'with-lease') {
        return {
          kind: 'rejected',
          reason: 'remote-moved',
          lostCommits: [{ sha: 'abc1234', subject: 'teammate work' }],
          remoteSha: 'PINNED_SHA'
        }
      }
      return ok
    })
    renderControl({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /overwrite remote anyway/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('overwrite', 'PINNED_SHA'))
  })

  it('re-shows the updated loss preview when the pinned overwrite is itself refused', async () => {
    let overwriteAttempts = 0
    const push = vi.fn(async (force?: PushForce): Promise<PushOutcome> => {
      if (force === 'with-lease') {
        return {
          kind: 'rejected',
          reason: 'remote-moved',
          lostCommits: [{ sha: 'aaa', subject: 'first teammate work' }],
          remoteSha: 'sha-1'
        }
      }
      if (force === 'overwrite') {
        overwriteAttempts += 1
        if (overwriteAttempts === 1) {
          return {
            kind: 'rejected',
            reason: 'remote-moved',
            lostCommits: [
              { sha: 'bbb', subject: 'second teammate work' },
              { sha: 'aaa', subject: 'first teammate work' }
            ],
            remoteSha: 'sha-2'
          }
        }
      }
      return ok
    })
    renderControl({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))
    fireEvent.click(await screen.findByRole('button', { name: /overwrite remote anyway/i }))

    expect(await screen.findByText('second teammate work')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /overwrite remote anyway/i }))

    await waitFor(() => expect(push).toHaveBeenLastCalledWith('overwrite', 'sha-2'))
  })

  it('does not offer an escalation when the leased force fails for a non-lease reason', async () => {
    const push = vi.fn(async (force?: PushForce): Promise<PushOutcome> => {
      if (force === 'with-lease') {
        return { kind: 'error', message: 'Permission denied' }
      }
      return ok
    })
    renderControl({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('with-lease'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: /overwrite remote anyway/i })
    ).not.toBeInTheDocument()
  })

  it('reveals a Force push option behind the caret that opens the Tier 1 confirm', async () => {
    const { push } = renderControl({ ahead: 1, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: /push options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /force push \(with lease\)/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /force push \(with lease\)/i })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not call an ahead-only branch diverged in a manual force confirmation', async () => {
    renderControl({ branchName: 'feature/x', ahead: 1, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: /push options/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /force push \(with lease\)/i }))

    expect(screen.getByRole('dialog')).not.toHaveTextContent('has diverged')
    expect(screen.getByRole('dialog')).toHaveTextContent('1 ahead and 0 behind')
  })

  it('disables the force option in detached HEAD', () => {
    renderControl({ detached: true, ahead: 0, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: /push options/i }))

    expect(screen.getByRole('menuitem', { name: /force push \(with lease\)/i })).toBeDisabled()
  })

  it('disables the primary push action in detached HEAD', () => {
    renderControl({ detached: true })

    expect(screen.getByRole('button', { name: 'Push' })).toBeDisabled()
  })

  it('dismisses the push menu with Escape', () => {
    renderControl()
    fireEvent.click(screen.getByRole('button', { name: /push options/i }))

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not reopen escalation after a pending force push dialog is cancelled', async () => {
    let resolveForce: (outcome: PushOutcome) => void = () => {}
    const push = vi.fn((force?: PushForce): Promise<PushOutcome> => {
      if (force === 'with-lease') {
        return new Promise((resolve) => {
          resolveForce = resolve
        })
      }
      return Promise.resolve(ok)
    })
    renderControl({ ahead: 2, behind: 3, push })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    resolveForce({
      kind: 'rejected',
      reason: 'remote-moved',
      lostCommits: [{ sha: 'abc1234', subject: 'late result' }],
      remoteSha: 'abc1234'
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('late result')).not.toBeInTheDocument()
  })

  it('shows a pending force confirmation and submits it only once', async () => {
    let resolveForce: (outcome: PushOutcome) => void = () => {}
    const push = vi.fn(
      () =>
        new Promise<PushOutcome>((resolve) => {
          resolveForce = resolve
        })
    )
    renderControl({ ahead: 2, behind: 3, push })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    const confirm = screen.getByRole('button', { name: /force push \(with lease\)/i })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(push).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Force pushing…' })).toBeDisabled()
    await act(async () => resolveForce(ok))
  })
})
