import { Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GitLog, GitLogEntry } from '../types'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
}

const ROW_H = 28
const RAIL_W = 28

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

function looksLikeMerge(message: string, hash: string): boolean {
  return /^merge\b/i.test(message) || /^merge pull request/i.test(message) || hash.length === 0
}

export function HistoryPanel({ log, loading }: HistoryPanelProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const commits: GitLogEntry[] = log?.all ?? []

  const visibleSet = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return null
    const set = new Set<string>()
    for (const c of commits) {
      if (
        c.message.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q)
      ) {
        set.add(c.hash)
      }
    }
    return set
  }, [filter, commits])

  const totalHeight = commits.length * ROW_H

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground">
            Timeline
          </h2>
          <span className="truncate text-[11px] text-muted-foreground">
            {log?.total
              ? `${log.total} commit${log.total === 1 ? '' : 's'}`
              : 'Repository timeline'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {commits.length > 0 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter commits…"
              className="h-6 w-40 rounded-[6px] border border-border bg-secondary px-2.5 text-[11.5px] text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-[color:var(--line-strong)]"
              style={{ transitionDuration: '60ms' }}
            />
          )}
          {loading && (
            <Badge
              variant="outline"
              className="h-5 gap-1 border-border bg-transparent px-1.5 text-[10px] font-normal text-muted-foreground"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Loading
            </Badge>
          )}
        </div>
      </header>

      {/* Column legend — mirrors the shell timeline header strip. */}
      {commits.length > 0 && (
        <div
          className="grid h-6 shrink-0 items-center gap-3 border-b border-border px-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--fg-faint)]"
          style={{ gridTemplateColumns: `${RAIL_W}px minmax(220px,1fr) 150px 60px 64px` }}
        >
          <span className="pl-3">Graph</span>
          <span>Subject</span>
          <span>Author</span>
          <span>Date</span>
          <span className="pr-3 text-right">SHA</span>
        </div>
      )}

      <ScrollArea className="flex-1">
        {!log || commits.length === 0 ? (
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
          <div className="relative">
            {/* Graph rail — vertical wire + commit dots, drawn behind the rows */}
            <svg
              width={RAIL_W}
              height={totalHeight}
              className="pointer-events-none absolute left-0 top-0"
              aria-hidden
            >
              <title>commit graph</title>
              <line
                x1={RAIL_W / 2}
                y1={ROW_H / 2}
                x2={RAIL_W / 2}
                y2={totalHeight - ROW_H / 2}
                stroke="var(--primary)"
                strokeOpacity={0.55}
                strokeWidth={1.4}
              />
              {commits.map((c, i) => {
                const cy = i * ROW_H + ROW_H / 2
                const merge = looksLikeMerge(c.message, c.hash)
                const dim = visibleSet && !visibleSet.has(c.hash)
                return merge ? (
                  <circle
                    key={c.hash}
                    cx={RAIL_W / 2}
                    cy={cy}
                    r={4}
                    fill="var(--background)"
                    stroke="var(--merge)"
                    strokeWidth={1.6}
                    opacity={dim ? 0.25 : 0.9}
                  />
                ) : (
                  <circle
                    key={c.hash}
                    cx={RAIL_W / 2}
                    cy={cy}
                    r={3.5}
                    fill="var(--primary)"
                    opacity={dim ? 0.25 : 1}
                  />
                )
              })}
            </svg>

            <ul style={{ height: totalHeight }} className="relative">
              {commits.map((c) => {
                const hov = hovered === c.hash
                const dim = visibleSet && !visibleSet.has(c.hash)
                const merge = looksLikeMerge(c.message, c.hash)
                return (
                  <li
                    key={c.hash}
                    onMouseEnter={() => setHovered(c.hash)}
                    onMouseLeave={() => setHovered(null)}
                    className="grid items-center gap-3 px-0"
                    style={{
                      height: ROW_H,
                      gridTemplateColumns: `${RAIL_W}px minmax(220px,1fr) 150px 60px 64px`,
                      backgroundColor: hov ? 'var(--accent)' : 'transparent',
                      transition: 'background-color 60ms ease',
                      opacity: dim ? 0.35 : 1
                    }}
                  >
                    <span aria-hidden />
                    <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-foreground">
                      <span className="min-w-0 truncate">{c.message}</span>
                      {merge && (
                        <span
                          className="inline-flex h-[16px] shrink-0 items-center rounded-[3px] border border-border px-1.5 font-mono text-[9.5px] text-[color:var(--merge)]"
                          title="merge commit"
                        >
                          merge
                        </span>
                      )}
                    </span>

                    <span
                      className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground"
                      title={c.author_name}
                    >
                      <span
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[8.5px] font-semibold text-foreground/70"
                        aria-hidden
                      >
                        {initials(c.author_name)}
                      </span>
                      <span className="min-w-0 truncate">{c.author_name}</span>
                    </span>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time className="cursor-default truncate font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          {formatRelative(c.date)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {new Date(c.date).toLocaleString()}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code className="cursor-default truncate pr-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          {c.hash.slice(0, 7)}
                        </code>
                      </TooltipTrigger>
                      <TooltipContent side="top">{c.hash}</TooltipContent>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
