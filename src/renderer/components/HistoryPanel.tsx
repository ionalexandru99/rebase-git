import { Loader2 } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GitLog } from '../types'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .padEnd(1, '?')
}

function formatRelative(date: string): string {
  const then = new Date(date).getTime()
  if (Number.isNaN(then)) return ''
  const diffMs = Date.now() - then
  const seconds = Math.round(diffMs / 1000)
  if (seconds < 60) return 'now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}

export function HistoryPanel({ log, loading }: HistoryPanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[12px] font-semibold text-foreground">Commit History</h2>
          <span className="truncate text-[11px] text-muted-foreground">
            {log?.total
              ? `${log.total} commit${log.total === 1 ? '' : 's'}`
              : 'Repository timeline'}
          </span>
        </div>
        {loading && (
          <Badge
            variant="outline"
            className="h-5 gap-1 border-border bg-transparent px-1.5 text-[10px] font-normal text-muted-foreground"
          >
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Loading
          </Badge>
        )}
      </header>

      <ScrollArea className="flex-1">
        {!log || log.all.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
            <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/60">
              <svg
                viewBox="0 0 16 16"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                role="img"
              >
                <title>commit</title>
                <circle cx="8" cy="8" r="2" />
                <path d="M0 8h6M10 8h6" />
              </svg>
            </div>
            <p className="text-[12px] font-medium text-foreground">No commits yet</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Make your first commit to populate the timeline.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {log.all.map((commit) => (
              <li
                key={commit.hash}
                className="group grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-1.5 transition-colors hover:bg-accent/50"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <code className="shrink-0 cursor-default font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                      {commit.hash.slice(0, 7)}
                    </code>
                  </TooltipTrigger>
                  <TooltipContent side="top">{commit.hash}</TooltipContent>
                </Tooltip>

                <p className="min-w-0 truncate text-[12px] text-foreground/90">{commit.message}</p>

                <Avatar size="sm" className="size-4 shrink-0">
                  <AvatarFallback className="bg-secondary text-[8.5px] font-medium text-muted-foreground">
                    {initials(commit.author_name)}
                  </AvatarFallback>
                </Avatar>

                <span
                  className="shrink-0 truncate text-[11px] text-muted-foreground"
                  title={commit.author_name}
                >
                  {commit.author_name}
                </span>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <time className="shrink-0 cursor-default font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                      {formatRelative(commit.date)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {new Date(commit.date).toLocaleString()}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </section>
  )
}
