import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { type PushFlowDeps, usePushFlow } from '../usePushFlow'

const ok: PushOutcome = { kind: 'ok' }

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

function Harness(props: PushFlowDeps) {
  const flow = usePushFlow(props)
  return (
    <>
      <button type="button" onClick={() => void flow.requestPush()}>
        Push
      </button>
      <button type="button" onClick={flow.openForceConfirm}>
        Ask to force push
      </button>
      {flow.dialogs}
    </>
  )
}

function renderFlow(overrides: Partial<PushFlowDeps> = {}) {
  const push = overrides.push ?? vi.fn(async () => ok)
  render(
    <Harness
      branchName={overrides.branchName ?? 'feature/x'}
      ahead={overrides.ahead ?? 1}
      behind={overrides.behind ?? 0}
      push={push}
    />
  )
  return { push }
}

describe('usePushFlow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('pushes plainly when the branch is fast-forwardable', async () => {
    const { push } = renderFlow({ ahead: 2, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
    expect(push).toHaveBeenCalledWith()
  })

  it('opens the Tier 1 confirm instead of pushing when the branch is Diverged', () => {
    const { push } = renderFlow({ branchName: 'feature/x', ahead: 2, behind: 3 })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('feature/x')
    expect(dialog).toHaveTextContent('2 ahead and 3 behind')
    expect(dialog).toHaveTextContent(/leased force republishes your rewritten history/i)
    expect(dialog).toHaveTextContent(/without destroying remote work you haven't seen/i)
    expect(screen.getByRole('button', { name: /force push \(with lease\)/i })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('escalates to the Tier 1 confirm when a plain push is refused as non-fast-forward', async () => {
    const push = vi.fn(
      async (): Promise<PushOutcome> => ({
        kind: 'rejected',
        reason: 'non-fast-forward',
        lostCommits: []
      })
    )
    renderFlow({ ahead: 2, behind: 0, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('issues a leased force when the Tier 1 confirm is accepted', async () => {
    const { push } = renderFlow({ ahead: 2, behind: 3 })

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
    renderFlow({ ahead: 2, behind: 3, push })

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
    renderFlow({ ahead: 2, behind: 3, push })

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
    renderFlow({ ahead: 2, behind: 3, push })

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
    renderFlow({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('with-lease'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: /overwrite remote anyway/i })
    ).not.toBeInTheDocument()
  })

  it('opens the Tier 1 confirm when a caller asks for a force push directly', () => {
    const { push } = renderFlow({ ahead: 1, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Ask to force push' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /force push \(with lease\)/i })).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('does not call an ahead-only branch diverged in a manual force confirmation', () => {
    renderFlow({ branchName: 'feature/x', ahead: 1, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Ask to force push' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('feature/x')
    expect(dialog).not.toHaveTextContent('has diverged')
    expect(dialog).toHaveTextContent('1 ahead and 0 behind')
    expect(dialog).toHaveTextContent(/leased force republishes your rewritten history/i)
    expect(dialog).toHaveTextContent(/without destroying remote work you haven't seen/i)
  })

  it('does not claim a behind-only branch has remote work to preserve', () => {
    renderFlow({ branchName: 'feature/x', ahead: 0, behind: 2 })

    fireEvent.click(screen.getByRole('button', { name: 'Ask to force push' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('feature/x is 2 behind its upstream')
    expect(dialog).toHaveTextContent(/rewind the remote to your older tip/i)
    expect(dialog).not.toHaveTextContent(/without destroying remote work/i)
    expect(dialog).not.toHaveTextContent('0 ahead')
  })

  it('does not report zero counts for a branch level with its upstream', () => {
    renderFlow({ branchName: 'feature/x', ahead: 0, behind: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Ask to force push' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('feature/x already matches its upstream')
    expect(dialog).not.toHaveTextContent('0 ahead')
    expect(dialog).not.toHaveTextContent('0 behind')
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
    renderFlow({ ahead: 2, behind: 3, push })
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

  it('says why the flow ended when a forced push is refused for a reason it cannot escalate', async () => {
    const push = vi.fn(
      async (): Promise<PushOutcome> => ({
        kind: 'rejected',
        reason: 'non-fast-forward',
        lostCommits: []
      })
    )
    renderFlow({ ahead: 2, behind: 3, push })

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: /force push \(with lease\)/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(toast.error).toHaveBeenCalledWith(
      'Force push rejected',
      expect.objectContaining({ description: expect.stringContaining('refused the update') })
    )
  })

  it('shows a pending force confirmation and submits it only once', async () => {
    let resolveForce: (outcome: PushOutcome) => void = () => {}
    const push = vi.fn(
      () =>
        new Promise<PushOutcome>((resolve) => {
          resolveForce = resolve
        })
    )
    renderFlow({ ahead: 2, behind: 3, push })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    const confirm = screen.getByRole('button', { name: /force push \(with lease\)/i })

    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(push).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Force pushing…' })).toBeDisabled()
    await act(async () => resolveForce(ok))
  })
})
