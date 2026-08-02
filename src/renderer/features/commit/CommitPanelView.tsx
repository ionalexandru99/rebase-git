import { Loader2Icon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface CommitPanelViewProps {
  message: string
  amend: boolean
  amendAvailable: boolean
  amendDisabled: boolean
  loading: boolean
  branch: string
  stagedCount: number
  concludesMerge: boolean
  commitBlockedReason?: string
  identityCallout?: ReactNode
  hasDroppedFiles: boolean
  expectedHeadAvailable: boolean
  onMessageChange: (message: string) => void
  onAmendChange: (amend: boolean) => void
  onCommit: () => void
}

const MAX_SUBJECT_LENGTH = 72
const MAX_MESSAGE_ROWS = 6

export function CommitPanelView(props: CommitPanelViewProps) {
  const [wrappedRows, setWrappedRows] = useState(1)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const node = textareaRef.current
    const lineHeight = node ? node.clientHeight / node.rows : 0
    if (props.message.length === 0 || !Number.isFinite(lineHeight) || lineHeight <= 0 || !node) {
      setWrappedRows(1)
      return
    }
    setWrappedRows(
      Math.min(Math.max(Math.ceil(node.scrollHeight / lineHeight), 1), MAX_MESSAGE_ROWS)
    )
  }, [props.message])

  const messageRows = Math.min(
    Math.max(props.message.split('\n').length, wrappedRows),
    MAX_MESSAGE_ROWS
  )
  const subjectLength = (props.message.split('\n')[0] ?? '').length
  const subjectWarn = subjectLength > MAX_SUBJECT_LENGTH
  const concludesMerge = props.concludesMerge && !props.amend
  const commitLabel = props.amend
    ? 'Amend'
    : concludesMerge
      ? 'Commit merge'
      : props.stagedCount > 0
        ? `Commit ${props.stagedCount} file${props.stagedCount === 1 ? '' : 's'}`
        : 'Commit'
  const commitDisabled =
    !props.message.trim() ||
    props.loading ||
    Boolean(props.commitBlockedReason) ||
    Boolean(props.identityCallout) ||
    (!props.amend && !concludesMerge && props.stagedCount === 0) ||
    (props.amend && !props.expectedHeadAvailable)

  return (
    <div className="shrink-0 border-t px-3 py-2" data-testid="commit-bar">
      {props.identityCallout}
      {props.commitBlockedReason ? (
        <p className="pb-1.5 text-xs text-amber-foreground">{props.commitBlockedReason}</p>
      ) : null}
      {props.hasDroppedFiles ? (
        <p className="pb-1.5 text-xs text-amber-foreground">
          Amend restores dropped files from the parent commit. Staged changes in dropped files will
          also be excluded.
        </p>
      ) : null}
      <div className="flex min-h-[36px] items-center gap-2 rounded-[var(--r-md)] border bg-background px-2 py-1 transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
        <span
          data-testid="commit-branch-chip"
          title={props.branch}
          className="inline-flex h-6 max-w-[140px] shrink-0 items-center truncate rounded-full px-2 text-xs font-semibold"
          style={{
            color: 'var(--blue)',
            backgroundColor: 'color-mix(in oklch, var(--blue) 16%, transparent)'
          }}
        >
          {props.branch}
        </span>
        <textarea
          ref={textareaRef}
          value={props.message}
          onChange={(event) => props.onMessageChange(event.currentTarget.value)}
          placeholder="Describe your changes…"
          aria-label="Commit message"
          rows={messageRows}
          className="min-w-0 flex-1 resize-none self-center border-0 bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none"
        />
        {props.amendAvailable ? (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={props.amend}
              disabled={props.amendDisabled || props.loading}
              onChange={(event) => props.onAmendChange(event.currentTarget.checked)}
              aria-label="Amend last commit"
              className="size-3.5 accent-[var(--brand)]"
            />
            Amend
          </label>
        ) : null}
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            subjectWarn ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {subjectLength} / {MAX_SUBJECT_LENGTH}
        </span>
        <button
          type="button"
          onClick={props.onCommit}
          disabled={commitDisabled}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
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
  )
}
