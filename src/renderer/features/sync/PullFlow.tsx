import { Loader2Icon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PullStrategy } from '@/lib/rpc-client'
import type { PullOutcome } from '@/stores/action-runner'
import { usePortalContainer } from '../../components/ui/portal-container'

export interface PullFlowDeps {
  pull: (strategy?: PullStrategy) => Promise<PullOutcome>
  loadRememberedStrategy: () => Promise<PullStrategy | null>
  rememberStrategy: (strategy: PullStrategy) => void
}

export interface PullFlow {
  requestPull: () => Promise<boolean>
  divergedDialog: ReactNode
}

function DivergedDialog(props: {
  pending: PullStrategy | null
  onChoose: (strategy: PullStrategy, remember: boolean) => void
  onDismiss: () => void
}) {
  const portalContainer = usePortalContainer()
  const [remember, setRemember] = useState(false)
  const { pending, onDismiss } = props
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && pending === null) {
        onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [pending, onDismiss])
  const choiceButtonClass =
    'inline-flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50'
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && pending === null) {
          onDismiss()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
      >
        <h2 className="text-sm font-semibold">Your branch and its upstream have diverged</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The remote has commits you don't have, and you have commits it doesn't. Choose how to
          combine them: rebase replays your commits on top of upstream for a linear history; merge
          joins the two lines with a merge commit.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            aria-label="Always use this choice"
          />
          Always use this choice
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending !== null}
            onClick={onDismiss}
            className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => props.onChoose('merge', remember)}
            className={choiceButtonClass}
          >
            {pending === 'merge' ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            Merge upstream
          </button>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => props.onChoose('rebase', remember)}
            className={choiceButtonClass}
          >
            {pending === 'rebase' ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
            Rebase onto upstream
          </button>
        </div>
      </div>
    </div>,
    portalContainer
  )
}

export function usePullFlow(deps: PullFlowDeps): PullFlow {
  const [choosing, setChoosing] = useState(false)
  const [pending, setPending] = useState<PullStrategy | null>(null)

  const pullWithStrategy = async (strategy: PullStrategy): Promise<boolean> => {
    setPending(strategy)
    try {
      const outcome = await deps.pull(strategy)
      return outcome.kind === 'ok'
    } finally {
      setPending(null)
      setChoosing(false)
    }
  }

  const requestPull = async (): Promise<boolean> => {
    const outcome = await deps.pull()
    if (outcome.kind !== 'diverged') {
      return outcome.kind === 'ok'
    }
    const remembered = await deps.loadRememberedStrategy().catch(() => null)
    if (remembered !== null) {
      return pullWithStrategy(remembered)
    }
    setChoosing(true)
    return false
  }

  const choose = (strategy: PullStrategy, remember: boolean) => {
    if (remember) {
      deps.rememberStrategy(strategy)
    }
    void pullWithStrategy(strategy)
  }

  const dismiss = () => {
    setChoosing(false)
  }

  const divergedDialog = choosing ? (
    <DivergedDialog pending={pending} onChoose={choose} onDismiss={dismiss} />
  ) : null

  return { requestPull, divergedDialog }
}
