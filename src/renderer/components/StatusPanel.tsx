import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import type { GitStatus, RenamedFile } from '../types'

interface StatusPanelProps {
  status: GitStatus | null
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  loading: boolean
}

type StatusKind = 'modified' | 'staged' | 'untracked' | 'conflicted' | 'deleted' | 'created'

function statusGlyph(kind: StatusKind): string {
  if (kind === 'modified') return 'M'
  if (kind === 'staged') return 'A'
  if (kind === 'untracked') return '?'
  if (kind === 'conflicted') return '!'
  if (kind === 'deleted') return 'D'
  return 'A'
}

function statusBadgeClass(kind: StatusKind): string {
  if (kind === 'conflicted') return 'border-destructive/40 bg-destructive/10 text-destructive'
  return ''
}

function FileRow({
  file,
  kind,
  actionLabel,
  onAction
}: {
  file: string
  kind: StatusKind
  actionLabel?: string
  onAction?: (file: string) => void
}) {
  return (
    <li className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <Badge
        variant="outline"
        aria-label={kind}
        className={`px-1.5 font-mono text-xs uppercase ${statusBadgeClass(kind)}`}
      >
        {statusGlyph(kind)}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm" title={file}>
        {file}
      </span>
      {actionLabel && onAction ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => onAction(file)}
        >
          {actionLabel}
        </Button>
      ) : null}
    </li>
  )
}

function RenamedRow({ entry }: { entry: RenamedFile }) {
  const label = `${entry.from} → ${entry.to}`
  return (
    <li className="flex h-7 items-center gap-2 rounded-md px-2 hover:bg-accent">
      <Badge variant="outline" aria-label="renamed" className="px-1.5 font-mono text-xs uppercase">
        R
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm" title={label}>
        {label}
      </span>
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
  if (!status) {
    if (loading) return <StatusPanelSkeleton />
    return null
  }

  const totalChanges =
    status.modified.length +
    status.staged.length +
    status.not_added.length +
    status.conflicted.length +
    status.deleted.length +
    status.created.length +
    status.renamed.length

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
        ) : status.conflicted.length > 0 ? (
          <Badge variant="destructive">{status.conflicted.length} conflict</Badge>
        ) : totalChanges === 0 ? (
          <Badge variant="secondary">Clean</Badge>
        ) : null}
      </header>

      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3 pt-2">
          {status.conflicted.length > 0 && (
            <>
              <SectionHeading label="Conflicted" count={status.conflicted.length} />
              <ul className="space-y-px">
                {status.conflicted.map((f) => (
                  <FileRow key={f} file={f} kind="conflicted" />
                ))}
              </ul>
            </>
          )}

          <SectionHeading label="Staged" count={status.staged.length + status.created.length} />
          {status.staged.length === 0 && status.created.length === 0 ? (
            <EmptyRow text="No staged files" />
          ) : (
            <ul className="space-y-px">
              {status.staged.map((f) => (
                <FileRow
                  key={`s:${f}`}
                  file={f}
                  kind="staged"
                  actionLabel="Unstage"
                  onAction={onUnstage}
                />
              ))}
              {status.created.map((f) => (
                <FileRow
                  key={`c:${f}`}
                  file={f}
                  kind="created"
                  actionLabel="Unstage"
                  onAction={onUnstage}
                />
              ))}
            </ul>
          )}

          <SectionHeading
            label="Changes"
            count={status.modified.length + status.deleted.length + status.renamed.length}
          />
          {status.modified.length + status.deleted.length + status.renamed.length === 0 ? (
            <EmptyRow text="No working-tree changes" />
          ) : (
            <ul className="space-y-px">
              {status.modified.map((f) => (
                <FileRow
                  key={`m:${f}`}
                  file={f}
                  kind="modified"
                  actionLabel="Stage"
                  onAction={onStage}
                />
              ))}
              {status.deleted.map((f) => (
                <FileRow
                  key={`d:${f}`}
                  file={f}
                  kind="deleted"
                  actionLabel="Stage"
                  onAction={onStage}
                />
              ))}
              {status.renamed.map((entry) => (
                <RenamedRow key={`r:${entry.from}->${entry.to}`} entry={entry} />
              ))}
            </ul>
          )}

          <SectionHeading label="Untracked" count={status.not_added.length} />
          {status.not_added.length === 0 ? (
            <EmptyRow text="No untracked files" />
          ) : (
            <ul className="space-y-px">
              {status.not_added.map((f) => (
                <FileRow
                  key={`u:${f}`}
                  file={f}
                  kind="untracked"
                  actionLabel="Stage"
                  onAction={onStage}
                />
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </section>
  )
}

function StatusPanelSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider">Working Directory</h2>
          <Skeleton className="h-3 w-24 rounded" />
        </div>
        <Skeleton className="h-5 w-16 rounded" />
      </header>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {(['Staged', 'Changes', 'Untracked'] as const).map((section) => (
          <div key={section} className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {section}
              </span>
              <Skeleton className="h-3 w-4 rounded" />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Skeleton className="size-3 rounded-sm" />
                <Skeleton className="h-3 rounded" style={{ width: `${55 + ((i * 19) % 30)}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
