import type { LostCommit } from '@shared/git-rpc-errors'
import { Loader2Icon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'
import { usePortalContainer } from '../../components/ui/portal-container'

export interface PushFlowDeps {
  branchName: string
  ahead: number
  behind: number
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
}

export interface PushFlow {
  requestPush: () => Promise<void>
  requestPushAfterPull: () => Promise<void>
  openForceConfirm: () => void
  dialogs: ReactNode
}

function Modal(props: { onDismiss: () => void; children: ReactNode }) {
  const portalContainer = usePortalContainer()
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onDismiss()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [props.onDismiss])
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onDismiss()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
      >
        {props.children}
      </div>
    </div>,
    portalContainer
  )
}

type Mode = 'idle' | 'tier1' | 'tier2'

interface LossPreview {
  lostCommits: readonly LostCommit[]
  remoteSha?: string
}

const leasedForceNote =
  "A leased force republishes your rewritten history without destroying remote work you haven't seen."

function forceConfirmDescription(branchName: string, ahead: number, behind: number) {
  if (ahead > 0 && behind > 0) {
    return `${branchName} has diverged from its upstream — it is ${ahead} ahead and ${behind} behind. ${leasedForceNote}`
  }
  if (ahead > 0) {
    return `${branchName} is ${ahead} ahead and ${behind} behind its upstream. ${leasedForceNote}`
  }
  if (behind > 0) {
    return `${branchName} is ${behind} behind its upstream with nothing of its own to publish — a leased force would rewind the remote to your older tip.`
  }
  return `${branchName} already matches its upstream — a leased force would republish the same commits and change nothing.`
}

export function usePushFlow(deps: PushFlowDeps): PushFlow {
  const [mode, setMode] = useState<Mode>('idle')
  const [loss, setLoss] = useState<LossPreview | null>(null)
  const [flowPending, setFlowPending] = useState(false)
  const flowGeneration = useRef(0)
  const pendingGeneration = useRef<number | null>(null)
  const isDiverged = deps.ahead > 0 && deps.behind > 0

  const dismissFlow = () => {
    flowGeneration.current += 1
    pendingGeneration.current = null
    setFlowPending(false)
    setMode('idle')
  }

  const openTier1 = () => {
    flowGeneration.current += 1
    pendingGeneration.current = null
    setFlowPending(false)
    setMode('tier1')
  }

  const handleForceOutcome = (outcome: PushOutcome) => {
    if (
      outcome.kind === 'rejected' &&
      (outcome.reason === 'lease-stale' || outcome.reason === 'remote-moved')
    ) {
      setLoss({ lostCommits: outcome.lostCommits, remoteSha: outcome.remoteSha })
      setMode('tier2')
      return
    }
    if (outcome.kind === 'rejected') {
      toast.error('Force push rejected', {
        description: 'The remote refused the update. Fetch, review the remote branch and try again.'
      })
    }
    setMode('idle')
  }

  const requestPushAfterPull = async () => {
    const outcome = await deps.push()
    if (outcome.kind === 'rejected' && outcome.reason === 'non-fast-forward') {
      openTier1()
    }
  }

  const requestPush = async () => {
    if (isDiverged) {
      openTier1()
      return
    }
    await requestPushAfterPull()
  }

  const onConfirmTier1 = async () => {
    const generation = flowGeneration.current
    if (pendingGeneration.current === generation) {
      return
    }
    pendingGeneration.current = generation
    setFlowPending(true)
    try {
      const outcome = await deps.push('with-lease')
      if (generation === flowGeneration.current) {
        handleForceOutcome(outcome)
      }
    } finally {
      if (pendingGeneration.current === generation) {
        pendingGeneration.current = null
        setFlowPending(false)
      }
    }
  }

  const onConfirmTier2 = async () => {
    const generation = flowGeneration.current
    if (pendingGeneration.current === generation) {
      return
    }
    pendingGeneration.current = generation
    setFlowPending(true)
    try {
      const outcome = await deps.push('overwrite', loss?.remoteSha)
      if (generation === flowGeneration.current) {
        handleForceOutcome(outcome)
      }
    } finally {
      if (pendingGeneration.current === generation) {
        pendingGeneration.current = null
        setFlowPending(false)
      }
    }
  }

  const dialogs = (
    <>
      {mode === 'tier1' ? (
        <Modal onDismiss={dismissFlow}>
          <h2 className="text-sm font-semibold">Force push {deps.branchName}?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {forceConfirmDescription(deps.branchName, deps.ahead, deps.behind)}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissFlow}
              className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmTier1()}
              disabled={flowPending}
              className="h-8 rounded-[var(--r-sm)] bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              {flowPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Force pushing…
                </span>
              ) : (
                'Force push (with lease)'
              )}
            </button>
          </div>
        </Modal>
      ) : null}

      {mode === 'tier2' && loss ? (
        <Modal onDismiss={dismissFlow}>
          <h2 className="text-sm font-semibold">Overwrite {deps.branchName} on the remote?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The remote has commits you don't have. Overwriting will permanently discard{' '}
            {loss.lostCommits.length === 1
              ? 'this commit'
              : `these ${loss.lostCommits.length} commits`}
            :
          </p>
          <ul className="mt-2 max-h-48 overflow-auto rounded-[var(--r-sm)] border bg-card p-2 text-sm">
            {loss.lostCommits.map((commit) => (
              <li key={commit.sha} className="flex gap-2 py-0.5">
                <code className="shrink-0 text-muted-foreground">{commit.sha}</code>
                <span className="truncate">{commit.subject}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={dismissFlow}
              className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmTier2()}
              disabled={flowPending}
              className="h-8 rounded-[var(--r-sm)] bg-destructive px-3 text-sm font-medium text-white"
            >
              {flowPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Overwriting…
                </span>
              ) : (
                'Overwrite remote anyway'
              )}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )

  return { requestPush, requestPushAfterPull, openForceConfirm: openTier1, dialogs }
}
