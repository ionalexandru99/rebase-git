import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { GitStatus } from '../types'

interface StatusPanelProps {
  status: GitStatus | null
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  loading: boolean
}

type StatusKind = 'modified' | 'staged' | 'untracked'

function statusGlyph(kind: StatusKind): string {
  if (kind === 'modified') return 'M'
  if (kind === 'staged') return 'A'
  return '?'
}

function FileRow({
  file,
  kind,
  actionLabel,
  onAction
}: {
  file: string
  kind: StatusKind
  actionLabel: string
  onAction: (file: string) => void
}) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) return
    const overflow = text.scrollWidth - wrap.clientWidth
    if (overflow > 0) {
      wrap.style.setProperty('--sp-scroll-dist', `-${overflow}px`)
      wrap.setAttribute('data-scrollable', '')
    } else {
      wrap.style.removeProperty('--sp-scroll-dist')
      wrap.removeAttribute('data-scrollable')
    }
  }, [file])

  return (
    <li
      className="group flex h-7 items-center gap-2 rounded-[4px] px-2 transition-colors hover:bg-accent"
      style={{ transitionDuration: '60ms' }}
    >
      <span
        role="img"
        aria-label={kind}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] bg-secondary font-mono text-[10px] font-semibold uppercase tracking-tighter text-muted-foreground"
      >
        {statusGlyph(kind)}
      </span>
      <span className="sp-file-wrap font-mono text-[11.5px] text-foreground/85" ref={wrapRef}>
        <span className="sp-file-text" ref={textRef}>{file}</span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 rounded-[3px] px-1.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={() => onAction(file)}
      >
        {actionLabel}
      </Button>
    </li>
  )
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mt-3 mb-1 flex items-center justify-between px-2 first:mt-0">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/60">{count}</span>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-[11.5px] italic text-muted-foreground/60">{text}</p>
}

export function StatusPanel({ status, onStage, onUnstage, loading }: StatusPanelProps) {
  if (!status) return null

  const totalChanges = status.modified.length + status.staged.length + status.not_added.length
  const subtitle =
    totalChanges === 0
      ? 'Clean working tree'
      : `${totalChanges} pending change${totalChanges === 1 ? '' : 's'}`

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground">
            Working Directory
          </h2>
          <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>
        </div>
        {loading ? (
          <Badge
            variant="outline"
            className="h-5 gap-1 border-border bg-transparent px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Loading
          </Badge>
        ) : totalChanges === 0 ? (
          <Badge
            variant="outline"
            className="h-5 border-border bg-transparent px-1.5 text-[10px] font-normal text-primary"
          >
            Clean
          </Badge>
        ) : null}
      </header>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3 pt-2">
          <SectionHeading label="Modified" count={status.modified.length} />
          {status.modified.length === 0 ? (
            <EmptyRow text="No modified files" />
          ) : (
            <ul className="space-y-px">
              {status.modified.map((f) => (
                <FileRow key={f} file={f} kind="modified" actionLabel="Stage" onAction={onStage} />
              ))}
            </ul>
          )}

          <SectionHeading label="Staged" count={status.staged.length} />
          {status.staged.length === 0 ? (
            <EmptyRow text="No staged files" />
          ) : (
            <ul className="space-y-px">
              {status.staged.map((f) => (
                <FileRow
                  key={f}
                  file={f}
                  kind="staged"
                  actionLabel="Unstage"
                  onAction={onUnstage}
                />
              ))}
            </ul>
          )}

          <SectionHeading label="Untracked" count={status.not_added.length} />
          {status.not_added.length === 0 ? (
            <EmptyRow text="No untracked files" />
          ) : (
            <ul className="space-y-px">
              {status.not_added.map((f) => (
                <FileRow key={f} file={f} kind="untracked" actionLabel="Stage" onAction={onStage} />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}
