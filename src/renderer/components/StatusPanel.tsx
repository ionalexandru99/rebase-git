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
  return (
    <li className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <Badge variant="outline" aria-label={kind} className="px-1.5 font-mono text-xs uppercase">
        {statusGlyph(kind)}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm" title={file}>
        {file}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-sm italic text-muted-foreground">{text}</p>
}

export function StatusPanel({ status, onStage, onUnstage, loading }: StatusPanelProps) {
  if (!status) return null

  const totalChanges = status.modified.length + status.staged.length + status.not_added.length
  const subtitle =
    totalChanges === 0
      ? 'Clean working tree'
      : `${totalChanges} pending change${totalChanges === 1 ? '' : 's'}`

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Working Directory</h2>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </div>
        {loading ? (
          <Badge variant="outline" className="gap-1">
            <Loader2 className="animate-spin" />
            Loading
          </Badge>
        ) : totalChanges === 0 ? (
          <Badge variant="secondary">Clean</Badge>
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
