import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PullStrategy } from '@/lib/rpc-client'
import type { PullOutcome } from '@/stores/action-runner'
import { usePullFlow } from '../PullFlow'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

const ok: PullOutcome = { kind: 'ok' }
const diverged: PullOutcome = { kind: 'diverged' }

interface HarnessProps {
  pull: (strategy?: PullStrategy) => Promise<PullOutcome>
  rememberedStrategy?: PullStrategy | null
  rememberStrategy?: (strategy: PullStrategy) => void
}

function Harness(props: HarnessProps) {
  const flow = usePullFlow({
    pull: props.pull,
    rememberedStrategy: props.rememberedStrategy ?? null,
    rememberStrategy: props.rememberStrategy ?? (() => {})
  })
  return (
    <>
      <button type="button" onClick={() => void flow.requestPull()}>
        Pull
      </button>
      {flow.divergedDialog}
    </>
  )
}

function renderFlow(overrides: Partial<HarnessProps> = {}) {
  const pull = overrides.pull ?? vi.fn(async () => ok)
  const rememberStrategy = overrides.rememberStrategy ?? vi.fn()
  render(
    <Harness
      pull={pull}
      rememberedStrategy={overrides.rememberedStrategy ?? null}
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
    const pull = vi.fn<(strategy?: PullStrategy) => Promise<PullOutcome>>(async () => diverged)
    renderFlow({ pull })

    await pullUntilDiverged(pull)

    expect(screen.getByRole('button', { name: 'Rebase onto upstream' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge upstream' })).toBeInTheDocument()
  })

  it('re-pulls with rebase when that choice is made', async () => {
    const pull = vi.fn<(strategy?: PullStrategy) => Promise<PullOutcome>>(async () => diverged)
    renderFlow({ pull })
    await pullUntilDiverged(pull)

    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Rebase onto upstream' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))
    expect(pull).toHaveBeenLastCalledWith('rebase')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not remember the choice unless asked to', async () => {
    const pull = vi.fn<(strategy?: PullStrategy) => Promise<PullOutcome>>(async () => diverged)
    const rememberStrategy = vi.fn()
    renderFlow({ pull, rememberStrategy })
    await pullUntilDiverged(pull)

    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Merge upstream' }))

    await waitFor(() => expect(pull).toHaveBeenLastCalledWith('merge'))
    expect(rememberStrategy).not.toHaveBeenCalled()
  })

  it('remembers the choice when the checkbox is ticked', async () => {
    const pull = vi.fn<(strategy?: PullStrategy) => Promise<PullOutcome>>(async () => diverged)
    const rememberStrategy = vi.fn()
    renderFlow({ pull, rememberStrategy })
    await pullUntilDiverged(pull)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Always use this choice' }))
    pull.mockResolvedValue(ok)
    fireEvent.click(screen.getByRole('button', { name: 'Merge upstream' }))

    await waitFor(() => expect(rememberStrategy).toHaveBeenCalledWith('merge'))
  })

  it('skips the dialog and re-pulls with the remembered strategy', async () => {
    const pull = vi.fn(async (strategy?: PullStrategy) => (strategy ? ok : diverged))
    renderFlow({ pull, rememberedStrategy: 'rebase' })

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))

    await waitFor(() => expect(pull).toHaveBeenCalledTimes(2))
    expect(pull).toHaveBeenLastCalledWith('rebase')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the dialog pulls nothing further', async () => {
    const pull = vi.fn<(strategy?: PullStrategy) => Promise<PullOutcome>>(async () => diverged)
    renderFlow({ pull })
    await pullUntilDiverged(pull)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pull).toHaveBeenCalledTimes(1)
  })
})
