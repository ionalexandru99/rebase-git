import type { LostCommit } from '@shared/git-rpc-errors'
import { ChevronDownIcon, Loader2Icon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PushForce } from '@/lib/rpc-client'
import type { PushOutcome } from '@/stores/action-runner'

const primaryButtonClass =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-l-[var(--r-sm)] bg-muted px-2.5 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'
const caretButtonClass =
  'inline-flex h-8 shrink-0 items-center rounded-r-[var(--r-sm)] border-l border-border bg-muted px-1 transition-colors hover:bg-border-strong disabled:cursor-default disabled:opacity-50'
const menuItemClass =
  'flex w-full items-center whitespace-nowrap rounded-[var(--r-xs)] px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent'

interface PushControlProps {
  branchName: string
  ahead: number
  behind: number
  detached: boolean
  pushing: boolean
  push: (force?: PushForce, expectedRemoteSha?: string) => Promise<PushOutcome>
}

function Modal(props: { onDismiss: () => void; children: ReactNode }) {
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
    document.body
  )
}

type Mode = 'idle' | 'tier1' | 'tier2'

interface LossPreview {
  lostCommits: readonly LostCommit[]
  remoteSha?: string
}

export function PushControl(props: PushControlProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [loss, setLoss] = useState<LossPreview | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const isDiverged = props.ahead > 0 && props.behind > 0

  // A leased force refused for a lease reason means the remote genuinely moved: escalate to the pinned
  // overwrite, showing exactly what the sidecar's fetch found would be lost. Any other outcome (ok, a
  // generic error already toasted by the runner) just closes the flow.
  const handleForceOutcome = (outcome: PushOutcome) => {
    if (
      outcome.kind === 'rejected' &&
      (outcome.reason === 'lease-stale' || outcome.reason === 'remote-moved')
    ) {
      setLoss({ lostCommits: outcome.lostCommits, remoteSha: outcome.remoteSha })
      setMode('tier2')
      return
    }
    setMode('idle')
  }

  const onPrimary = async () => {
    if (isDiverged) {
      setMode('tier1')
      return
    }
    const outcome = await props.push()
    if (outcome.kind === 'rejected' && outcome.reason === 'non-fast-forward') {
      setMode('tier1')
    }
  }

  const onConfirmTier1 = async () => {
    handleForceOutcome(await props.push('with-lease'))
  }

  const onConfirmTier2 = async () => {
    handleForceOutcome(await props.push('overwrite', loss?.remoteSha))
  }

  const openForceConfirm = () => {
    setMenuOpen(false)
    setMode('tier1')
  }

  return (
    <>
      <div className="relative inline-flex">
        <button
          type="button"
          onClick={() => void onPrimary()}
          disabled={props.pushing}
          className={primaryButtonClass}
        >
          {props.pushing ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          Push
        </button>
        <button
          type="button"
          aria-label="Push options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          disabled={props.pushing}
          className={caretButtonClass}
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] rounded-[var(--r-sm)] border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              disabled={props.detached}
              onClick={openForceConfirm}
              className={menuItemClass}
            >
              Force push (with lease)
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'tier1' ? (
        <Modal onDismiss={() => setMode('idle')}>
          <h2 className="text-sm font-semibold">Force push {props.branchName}?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {props.branchName} has diverged from its upstream — it is {props.ahead} ahead and{' '}
            {props.behind} behind. A leased force republishes your rewritten history without
            destroying remote work you haven't seen.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmTier1()}
              className="h-8 rounded-[var(--r-sm)] bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              Force push (with lease)
            </button>
          </div>
        </Modal>
      ) : null}

      {mode === 'tier2' && loss ? (
        <Modal onDismiss={() => setMode('idle')}>
          <h2 className="text-sm font-semibold">Overwrite {props.branchName} on the remote?</h2>
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
              onClick={() => setMode('idle')}
              className="h-8 rounded-[var(--r-sm)] border bg-card px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirmTier2()}
              className="h-8 rounded-[var(--r-sm)] bg-destructive px-3 text-sm font-medium text-white"
            >
              Overwrite remote anyway
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
