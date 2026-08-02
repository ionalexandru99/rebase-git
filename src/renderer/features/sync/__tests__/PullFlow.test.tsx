import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullStrategy } from '@/lib/rpc-client'
import type { PullOutcome } from '@/stores/action-runner'
import { usePullFlow } from '../PullFlow'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

const ok: PullOutcome = { kind: 'ok' }
const diverged: PullOutcome = { kind: 'diverged' }

type PullFn = (strategy?: PullStrategy) => Promise<PullOutcome>

interface HarnessProps {
  pull: PullFn
  loadRememberedStrategy?: () => Promise<PullStrategy | null>
  rememberStrategy?: (strategy: PullStrategy) => void
}

function Harness(props: HarnessProps) {
  const flow = usePullFlow({
    pull: props.pull,
    loadRememberedStrategy: props.loadRememberedStrategy ?? (async () => null),
    rememberStrategy: props.rememberStrategy ?? (() => {})
  })
  const [result, setResult] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void flow.requestPull().then((success) => setResult(success ? 'success' : 'stopped'))
        }
      >
        Pull
      </button>
      {result ? <output>{result}</output> : null}
      {flow.divergedDialog}
    </>
  )
}

function renderFlow(overrides: Partial<HarnessProps> = {}) {
  const pull = overrides.pull ?? vi.fn<PullFn>(async () => ok)
  const rememberStrategy = overrides.rememberStrategy ?? vi.fn()
  render(
    <Harness
      pull={pull}
      loadRememberedStrategy={overrides.loadRememberedStrategy}
      rememberStrategy={rememberStrategy}
    />
  )
  return { pull, rememberStrategy }
}

async function pullUntilDiverged(pull: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
  await waitFor(() => expect(pull).toHaveBeenCalledTimes(1))
  return screen.findByRole('dialog')
}

async function renderDivergedFlow(overrides: Omit<Partial<HarnessProps>, 'pull'> = {}) {
  const pull = vi.fn<PullFn>(async () => diverged)
  const rendered = renderFlow({ ...overrides, pull })
  const dialog = await pullUntilDiverged(pull)
  return { ...rendered, pull, dialog }
}

function deferredPull() {
  let resolvePull = (_outcome: PullOutcome) => {}
  const pull = vi.fn<PullFn>(async (strategy?: PullStrategy) => {
    if (strategy === undefined) {
      return diverged
    }
    return new Promise<PullOutcome>((resolve) => {
      resolvePull = resolve
    })
  })
  return { pull, resolve: (outcome: PullOutcome) => resolvePull(outcome) }
}

describe('usePullFlow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('pulls plainly and shows no dialog when the pull fast-forwards', async () => {
    const { pull } = renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1))
    expect(pull).toHaveBeenCalledWith()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers rebase or merge when the pull reports divergence', async () => {
    await renderDivergedFlow()

    expect(screen.getByRole('button', { name: 'Rebase onto upstream' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge upstream' })).toBeInTheDocument()
  })

  it('re-pulls with rebase when that choice is made', async () => {
    const { pull } = await renderDivergedFlow()

    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Rebase onto upstream' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))
    expect(pull).toHaveBeenLastCalledWith('rebase')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('success')).toBeInTheDocument()
  })

  it('does not remember the choice unless asked to', async () => {
    const { pull, rememberStrategy } = await renderDivergedFlow()

    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Merge upstream' }))

    await waitFor(() => expect(pull).toHaveBeenLastCalledWith('merge'))
    expect(rememberStrategy).not.toHaveBeenCalled()
  })

  it('remembers the choice when the checkbox is ticked', async () => {
    const { pull, rememberStrategy } = await renderDivergedFlow()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Always use this choice' }))
    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Merge upstream' }))

    await waitFor(() => expect(rememberStrategy).toHaveBeenCalledWith('merge'))
  })

  it('skips the dialog and re-pulls with the remembered strategy', async () => {
    const pull = vi.fn<PullFn>(async (strategy?: PullStrategy) => (strategy ? ok : diverged))
    renderFlow({ pull, loadRememberedStrategy: async () => 'rebase' })

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))
    expect(pull).toHaveBeenLastCalledWith('rebase')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('applies a persisted strategy that loads slowly instead of opening the dialog', async () => {
    const pull = vi.fn<PullFn>(async (strategy?: PullStrategy) => (strategy ? ok : diverged))
    const loadRememberedStrategy = () =>
      new Promise<PullStrategy | null>((resolve) => {
        setTimeout(() => resolve('merge'), 50)
      })
    renderFlow({ pull, loadRememberedStrategy })

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))
    expect(pull).toHaveBeenLastCalledWith('merge')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the dialog pulls nothing further', async () => {
    const { pull } = await renderDivergedFlow()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pull).toHaveBeenCalledTimes(1)
    expect(screen.getByText('stopped')).toBeInTheDocument()
  })

  it('dismisses on Escape without pulling again', async () => {
    const { pull } = await renderDivergedFlow()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('dismisses on a backdrop click without pulling again', async () => {
    const { pull, dialog } = await renderDivergedFlow()
    const backdrop = dialog.parentElement as HTMLElement

    fireEvent.pointerDown(backdrop)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pull).toHaveBeenCalledTimes(1)
  })

  it('disables every button and ignores dismissal while the chosen pull is running', async () => {
    const { pull, resolve } = deferredPull()
    renderFlow({ pull })
    await pullUntilDiverged(pull)

    fireEvent.click(screen.getByRole('button', { name: 'Rebase onto upstream' }))
    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))

    expect(screen.getByRole('button', { name: 'Rebase onto upstream' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Merge upstream' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    fireEvent.keyDown(document, { key: 'Escape' })
    const backdrop = screen.getByRole('dialog').parentElement as HTMLElement
    fireEvent.pointerDown(backdrop)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    resolve(ok)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pull).toHaveBeenCalledTimes(2)
  })
})
