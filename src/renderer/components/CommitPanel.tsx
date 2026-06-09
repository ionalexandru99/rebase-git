import { Loader2Icon } from 'lucide-react'
import type { ReactNode } from 'react'
import { createSignal, Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

interface CommitPanelProps {
  onCommit: (message: string) => Promise<boolean>
  loading: boolean
  branch: string
  stagedCount: number
  ahead?: number
}

const MAX_SUBJECT_LENGTH = 72

export function CommitPanel(props: CommitPanelProps) {
  const [message, setMessage] = createSignal('')

  const handleCommit = async () => {
    const trimmed = message().trim()
    if (!trimmed) {
      return
    }
    const success = await props.onCommit(trimmed)
    if (success) {
      setMessage('')
    }
  }

  const subjectLength = () => (message().split('\n')[0] ?? '').length
  const subjectWarn = () => subjectLength() > MAX_SUBJECT_LENGTH
  const commitLabel = () =>
    props.stagedCount > 0
      ? `Commit ${props.stagedCount} file${props.stagedCount === 1 ? '' : 's'}`
      : 'Commit'

  return (
    <div className="shrink-0 border-t px-3 pb-3 pt-2.5">
      <div className="rounded-[var(--r-md)] border bg-background p-2 transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
        <textarea
          value={message()}
          onChange={(event) => setMessage(event.currentTarget.value)}
          placeholder="Describe your changes…"
          aria-label="Commit message"
          rows={2}
          className="max-h-36 min-h-[50px] w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm text-foreground outline-none"
        />
        <div className="flex items-center gap-2 px-1 pb-0.5 pt-1.5">
          <div className="flex items-center gap-1.5">
            <MetaChip color="var(--blue)">{props.branch}</MetaChip>
            <Show when={props.stagedCount > 0}>
              <MetaChip color="var(--green)">{props.stagedCount} staged</MetaChip>
            </Show>
            <Show when={(props.ahead ?? 0) > 0}>
              <MetaChip color="var(--green)">↑{props.ahead}</MetaChip>
            </Show>
          </div>
          <div className="flex-1" />
          <span
            className={cn(
              'text-xs tabular-nums',
              subjectWarn() ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {subjectLength()} / {MAX_SUBJECT_LENGTH}
          </span>
          <button
            type="button"
            onClick={handleCommit}
            disabled={!message().trim() || props.loading || props.stagedCount === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-sm)] bg-brand px-3 font-semibold text-brand-foreground transition-colors hover:bg-[var(--brand-strong)] disabled:opacity-50"
          >
            <Show when={props.loading} fallback={commitLabel()}>
              <Loader2Icon className="size-3.5 animate-spin" />
              Committing…
            </Show>
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
