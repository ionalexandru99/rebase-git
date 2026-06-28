import { Loader2Icon } from 'lucide-react'
import type { ChangeEvent, ReactNode } from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  onAmend: (
    message: string,
    droppedHeadPaths: string[],
    droppedHeadHunks: { file: string; hunks: string[] }[]
  ) => Promise<boolean>
  loadHeadMessage: () => Promise<string | null>
  amendAvailable: boolean
  amendDisabled: boolean
  loading: boolean
  branch: string
  stagedCount: number
  ahead?: number
  onAmendChange?: (amend: boolean) => void
  droppedHeadPaths?: string[]
  droppedHeadHunks?: { file: string; hunks: string[] }[]
}

const MAX_SUBJECT_LENGTH = 72

export function CommitPanel(props: CommitPanelProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [savedDraft, setSavedDraft] = useState('')

  // Entering amend prefills HEAD's full message but stashes the in-progress draft so un-ticking is a
  // perfect no-op; nothing in the repository changes until the user presses Amend.
  const handleAmendToggle = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.checked) {
      setSavedDraft(message)
      const headMessage = await props.loadHeadMessage()
      setAmend(true)
      props.onAmendChange?.(true)
      if (headMessage !== null) {
        setMessage(headMessage)
      }
    } else {
      setAmend(false)
      props.onAmendChange?.(false)
      setMessage(savedDraft)
    }
  }

  const handleCommit = async () => {
    const trimmed = message.trim()
    if (!trimmed) {
      return
    }
    const success = await (amend
      ? props.onAmend(trimmed, props.droppedHeadPaths ?? [], props.droppedHeadHunks ?? [])
      : props.onCommit(trimmed))
    if (success) {
      setMessage('')
      setAmend(false)
      props.onAmendChange?.(false)
    }
  }

  const subjectLength = (message.split('\n')[0] ?? '').length
  const subjectWarn = subjectLength > MAX_SUBJECT_LENGTH
  const commitLabel = amend
    ? 'Amend'
    : props.stagedCount > 0
      ? `Commit ${props.stagedCount} file${props.stagedCount === 1 ? '' : 's'}`
      : 'Commit'
  const commitDisabled = !message.trim() || props.loading || (!amend && props.stagedCount === 0)

  return (
    <div className="shrink-0 border-t px-3 pb-3 pt-2.5">
      <div className="rounded-[var(--r-md)] border bg-background p-2 transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          placeholder="Describe your changes…"
          aria-label="Commit message"
          rows={2}
          className="max-h-36 min-h-[50px] w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm text-foreground outline-none"
        />
        <div className="flex items-center gap-2 px-1 pb-0.5 pt-1.5">
          <div className="flex items-center gap-1.5">
            <MetaChip color="var(--blue)">{props.branch}</MetaChip>
            {props.stagedCount > 0 && (
              <MetaChip color="var(--green)">{props.stagedCount} staged</MetaChip>
            )}
            {(props.ahead ?? 0) > 0 && <MetaChip color="var(--green)">↑{props.ahead}</MetaChip>}
            {props.amendAvailable && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={amend}
                  disabled={props.amendDisabled || props.loading}
                  onChange={handleAmendToggle}
                  aria-label="Amend last commit"
                  className="size-3.5 accent-[var(--brand)]"
                />
                Amend last commit
              </label>
            )}
          </div>
          <div className="flex-1" />
          <span
            className={cn(
              'text-xs tabular-nums',
              subjectWarn ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {subjectLength} / {MAX_SUBJECT_LENGTH}
          </span>
          <button
            type="button"
            onClick={handleCommit}
            disabled={commitDisabled}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] bg-brand px-3 font-semibold text-brand-foreground transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
          >
            {props.loading ? (
              <>
                <Loader2Icon className="size-3.5 animate-spin" />
                Committing…
              </>
            ) : (
              commitLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function MetaChip(props: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold"
      style={{
        color: props.color,
        backgroundColor: `color-mix(in oklch, ${props.color} 16%, transparent)`
      }}
    >
      {props.children}
    </span>
  )
}
