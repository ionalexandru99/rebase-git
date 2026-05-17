import { Loader2 } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
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
  const [scrollDist, setScrollDist] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: file name change must re-trigger DOM measurement
  useEffect(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) return
    const overflow = text.scrollWidth - wrap.clientWidth
    setScrollDist(overflow > 0 ? overflow : 0)
  }, [file])

  const isScrollable = scrollDist > 0
  const marqueeStyle: CSSProperties | undefined = isScrollable
    ? ({ '--marquee-dist': `-${scrollDist}px` } as CSSProperties)
    : undefined

  return (
    <li className="group flex h-7 items-center gap-2 rounded-md px-2 transition-colors duration-75 hover:bg-accent">
      <span
        role="img"
        aria-label={kind}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-secondary text-xs font-semibold uppercase tracking-tighter text-muted-foreground"
      >
        {statusGlyph(kind)}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden text-sm text-foreground/85" ref={wrapRef}>
        <span
          ref={textRef}
          data-marquee={isScrollable ? '' : undefined}
          className={cn(
            'inline-block whitespace-nowrap',
            isScrollable && 'motion-safe:group-hover:animate-marquee'
          )}
          style={marqueeStyle}
        >
          {file}
        </span>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 shrink-0 rounded-sm px-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
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
      <span className="text-xs tabular-nums text-muted-foreground/60">{count}</span>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-2 py-1.5 text-sm italic text-muted-foreground/60">{text}</p>
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
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Working Directory
          </h2>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </div>
        {loading ? (
          <Badge
            variant="outline"
            className="gap-1 border-border bg-transparent font-normal text-muted-foreground"
          >
            <Loader2 className="animate-spin" />
            Loading
          </Badge>
        ) : totalChanges === 0 ? (
          <Badge
            variant="outline"
            className="border-border bg-transparent font-normal text-primary"
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
