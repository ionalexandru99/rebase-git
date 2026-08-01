import { Loader2Icon } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  onAmend: (
    message: string,
    droppedHeadPaths: string[],
    droppedHeadHunks: { file: string; hunks: string[] }[],
    expectedHead: string
  ) => Promise<boolean>
  expectedHead: string | undefined
  loadHeadMessage: () => Promise<string | null>
  amendAvailable: boolean
  amendDisabled: boolean
  loading: boolean
  branch: string
  stagedCount: number
  onAmendChange?: (amend: boolean) => void
  droppedHeadPaths?: string[]
  droppedHeadHunks?: { file: string; hunks: string[] }[]
  prefillMessage?: string
  concludesMerge?: boolean
  commitBlockedReason?: string
}

const MAX_SUBJECT_LENGTH = 72

const MAX_MESSAGE_ROWS = 6

export function CommitPanel(props: CommitPanelProps) {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [savedDraft, setSavedDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [wrappedRows, setWrappedRows] = useState(1)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messageRef = useRef(message)
  const amendRef = useRef(amend)
  const amendLoadGeneration = useRef(0)
  const submittingRef = useRef(false)
  const appliedPrefill = useRef<string | undefined>(undefined)

  useEffect(() => {
    const prefill = props.prefillMessage
    if (prefill === appliedPrefill.current) {
      return
    }
    const userTyped =
      messageRef.current.trim().length > 0 && messageRef.current !== appliedPrefill.current
    appliedPrefill.current = prefill
    if (userTyped || amendRef.current) {
      return
    }
    messageRef.current = prefill ?? ''
    setMessage(prefill ?? '')
  }, [props.prefillMessage])

  useEffect(() => {
    const node = textareaRef.current
    const lineHeight = node ? node.clientHeight / node.rows : 0
    if (message.length === 0 || !Number.isFinite(lineHeight) || lineHeight <= 0 || !node) {
      setWrappedRows(1)
      return
    }
    setWrappedRows(
      Math.min(Math.max(Math.ceil(node.scrollHeight / lineHeight), 1), MAX_MESSAGE_ROWS)
    )
  }, [message])

  const handleAmendToggle = async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.currentTarget.checked) {
      setSavedDraft(message)
      amendRef.current = true
      setAmend(true)
      props.onAmendChange?.(true)
      const generation = amendLoadGeneration.current + 1
      amendLoadGeneration.current = generation
      const headMessage = await props.loadHeadMessage()
      if (headMessage !== null && amendRef.current && amendLoadGeneration.current === generation) {
        messageRef.current = headMessage
        setMessage(headMessage)
      }
    } else {
      amendLoadGeneration.current += 1
      amendRef.current = false
      setAmend(false)
      props.onAmendChange?.(false)
      messageRef.current = savedDraft
      setMessage(savedDraft)
    }
  }

  const handleCommit = async () => {
    if (submittingRef.current) {
      return
    }
    const submittedMessage = messageRef.current
    const trimmed = submittedMessage.trim()
    if (!trimmed) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      let success: boolean
      if (amendRef.current) {
        const expectedHead = props.expectedHead
        if (!expectedHead) {
          return
        }
        success = await props.onAmend(
          trimmed,
          props.droppedHeadPaths ?? [],
          props.droppedHeadHunks ?? [],
          expectedHead
        )
      } else {
        success = await props.onCommit(trimmed)
      }
      if (success) {
        setMessage((current) => {
          if (current !== submittedMessage) {
            return current
          }
          messageRef.current = ''
          return ''
        })
        amendRef.current = false
        setAmend(false)
        props.onAmendChange?.(false)
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const messageRows = Math.min(Math.max(message.split('\n').length, wrappedRows), MAX_MESSAGE_ROWS)
  const subjectLength = (message.split('\n')[0] ?? '').length
  const subjectWarn = subjectLength > MAX_SUBJECT_LENGTH
  const concludesMerge = Boolean(props.concludesMerge) && !amend
  const commitLabel = amend
    ? 'Amend'
    : concludesMerge
      ? 'Commit merge'
      : props.stagedCount > 0
        ? `Commit ${props.stagedCount} file${props.stagedCount === 1 ? '' : 's'}`
        : 'Commit'
  const loading = props.loading || submitting
  const hasDroppedFiles = amend && (props.droppedHeadPaths?.length ?? 0) > 0
  const commitBlocked = Boolean(props.commitBlockedReason)
  const commitDisabled =
    !message.trim() ||
    loading ||
    commitBlocked ||
    (!amend && !concludesMerge && props.stagedCount === 0) ||
    (amend && !props.expectedHead)

  return (
    <div className="shrink-0 border-t px-3 py-2" data-testid="commit-bar">
      {commitBlocked ? (
        <p className="pb-1.5 text-xs text-amber-foreground">{props.commitBlockedReason}</p>
      ) : null}
      {hasDroppedFiles ? (
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
          value={message}
          onChange={(event) => {
            const nextMessage = event.currentTarget.value
            amendLoadGeneration.current += 1
            messageRef.current = nextMessage
            setMessage(nextMessage)
          }}
          placeholder="Describe your changes…"
          aria-label="Commit message"
          rows={messageRows}
          className="min-w-0 flex-1 resize-none self-center border-0 bg-transparent px-1 py-1 text-sm leading-5 text-foreground outline-none"
        />
        {props.amendAvailable && (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={amend}
              disabled={props.amendDisabled || loading}
              onChange={handleAmendToggle}
              aria-label="Amend last commit"
              className="size-3.5 accent-[var(--brand)]"
            />
            Amend
          </label>
        )}
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
          onClick={handleCommit}
          disabled={commitDisabled}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--r-sm)] bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
        >
          {loading ? (
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
