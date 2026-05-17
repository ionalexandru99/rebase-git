import { Loader2 } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GitLog, GitLogEntry } from '../types'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
}

const ROW_H = 28
const COL_W = 14
const RAIL_PAD = 12
const DOT_R = 3.5

// Stable per-lane color palette. The lane index is the only thing we have to
// distinguish branches visually — names are not always populated by %D.
const LANE_PALETTE = [
  '#7c8cff',
  '#5fb4e4',
  '#e6804c',
  '#6ec48a',
  '#c97cd1',
  '#d9c356',
  '#6dd2c4',
  '#e36c8f'
]

function laneColor(lane: number): string {
  return LANE_PALETTE[lane % LANE_PALETTE.length]
}

function laneX(lane: number): number {
  return RAIL_PAD + lane * COL_W
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

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

function formatCommitDate(date: string): string {
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return ''
  return DATE_FORMATTER.format(t)
}

interface ParsedRef {
  label: string
  kind: 'head' | 'branch' | 'remote' | 'tag' | 'stash'
}

// Drops a remote `origin/X` (or any `*/X`) when a local branch `X` is also
// present on the same commit — they're at the same SHA, so showing both is
// noise.
function dedupeRefs(parsed: ParsedRef[]): ParsedRef[] {
  const localNames = new Set(
    parsed.filter((r) => r.kind === 'branch' || r.kind === 'head').map((r) => r.label)
  )
  return parsed.filter((r) => {
    if (r.kind !== 'remote') return true
    const slash = r.label.lastIndexOf('/')
    const branchName = slash === -1 ? r.label : r.label.slice(slash + 1)
    return !localNames.has(branchName)
  })
}

export function parseRefs(refs: string): ParsedRef[] {
  if (!refs) return []
  const parsed = refs
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map<ParsedRef>((part) => {
      if (part.startsWith('HEAD -> ')) return { label: part.slice(8), kind: 'head' }
      if (part === 'HEAD') return { label: 'HEAD', kind: 'head' }
      if (part.startsWith('tag: ')) return { label: part.slice(5), kind: 'tag' }
      if (/^stash@\{/.test(part)) return { label: part, kind: 'stash' }
      if (part.includes('/')) return { label: part, kind: 'remote' }
      return { label: part, kind: 'branch' }
    })
  return dedupeRefs(parsed)
}

interface RowLayout {
  commit: GitLogEntry
  commitLane: number
  incoming: (string | null)[]
  outgoing: (string | null)[]
}

// Compute per-row lane state by walking commits in display order.
// Each lane "waits" for a specific parent hash. When a commit matches one of
// the waiting hashes, its dot occupies that lane; otherwise it gets a fresh
// lane (first null slot, else appended).
export function layoutCommits(commits: GitLogEntry[]): {
  rows: RowLayout[]
  maxLanes: number
} {
  let lanes: (string | null)[] = []
  const rows: RowLayout[] = []
  let maxLanes = 0

  for (const c of commits) {
    const incoming = [...lanes]

    let commitLane = lanes.indexOf(c.hash)
    if (commitLane === -1) {
      commitLane = lanes.indexOf(null)
      if (commitLane === -1) {
        commitLane = lanes.length
        lanes.push(null)
      }
    }

    // All lanes waiting for this hash collapse into commitLane.
    lanes = lanes.map((l) => (l === c.hash ? null : l))

    for (let pi = 0; pi < c.parents.length; pi++) {
      const p = c.parents[pi]
      if (lanes.includes(p)) continue
      if (pi === 0 && (lanes[commitLane] === null || lanes[commitLane] === undefined)) {
        lanes[commitLane] = p
        continue
      }
      const slot = lanes.indexOf(null)
      if (slot !== -1) lanes[slot] = p
      else lanes.push(p)
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()

    const outgoing = [...lanes]
    maxLanes = Math.max(maxLanes, incoming.length, outgoing.length, commitLane + 1)

    rows.push({ commit: c, commitLane, incoming, outgoing })
  }

  return { rows, maxLanes }
}

function refClass(kind: ParsedRef['kind']): string {
  switch (kind) {
    case 'head':
      return 'border-[color:var(--primary)]/40 bg-[color:var(--primary)]/10 text-[color:var(--primary)]'
    case 'branch':
      return 'border-border bg-secondary text-foreground/80'
    case 'remote':
      return 'border-border/60 bg-transparent text-muted-foreground'
    case 'tag':
      return 'border-[color:var(--merge)]/40 bg-[color:var(--merge)]/10 text-[color:var(--merge)]'
    case 'stash':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  }
}

export function HistoryPanel({ log, loading }: HistoryPanelProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const commits: GitLogEntry[] = log?.all ?? []

  const { rows, maxLanes } = useMemo(() => layoutCommits(commits), [commits])
  const railWidth = Math.max(28, RAIL_PAD * 2 + Math.max(maxLanes - 1, 0) * COL_W)

  const visibleSet = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return null
    const set = new Set<string>()
    for (const c of commits) {
      if (
        c.message.toLowerCase().includes(q) ||
        c.hash.toLowerCase().includes(q) ||
        c.author_name.toLowerCase().includes(q) ||
        c.refs.toLowerCase().includes(q)
      ) {
        set.add(c.hash)
      }
    }
    return set
  }, [filter, commits])

  const totalHeight = rows.length * ROW_H
  const gridTemplate = `${railWidth}px minmax(220px,1fr) 150px 110px 64px`

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Timeline
          </h2>
          <span className="truncate text-xs text-muted-foreground">
            {log?.total
              ? `${log.total} commit${log.total === 1 ? '' : 's'} · all branches`
              : 'Repository timeline'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {commits.length > 0 && (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter commits…"
              className="h-6 w-40 rounded-md border border-border bg-secondary px-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors duration-75 focus:border-[color:var(--line-strong)]"
            />
          )}
          {loading && (
            <Badge
              variant="outline"
              className="gap-1 border-border bg-transparent font-normal text-muted-foreground"
            >
              <Loader2 className="animate-spin" />
              Loading
            </Badge>
          )}
        </div>
      </header>

      {commits.length > 0 && (
        <div
          className="grid h-6 shrink-0 items-center gap-3 border-b border-border px-0 text-xs font-semibold uppercase tracking-wider text-[color:var(--fg-faint)]"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="pl-3">Graph</span>
          <span>Subject</span>
          <span>Author</span>
          <span>Date</span>
          <span className="pr-3 text-right">SHA</span>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
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
            <p className="text-sm font-medium text-foreground">No commits yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Make your first commit to populate the timeline.
            </p>
          </div>
        ) : (
          <div className="relative">
            <svg
              width={railWidth}
              height={totalHeight}
              className="pointer-events-none absolute left-0 top-0"
              aria-hidden
            >
              <title>commit graph</title>
              {rows.map((row, i) => {
                const rowTop = i * ROW_H
                const rowMid = rowTop + ROW_H / 2
                const rowBot = rowTop + ROW_H
                const dim = visibleSet && !visibleSet.has(row.commit.hash)
                const dotX = laneX(row.commitLane)

                const topEdges = row.incoming.map((h, j) => {
                  if (h === null) return null
                  const color = laneColor(j)
                  const opacity = dim ? 0.2 : 0.85
                  if (h === row.commit.hash) {
                    if (j === row.commitLane) {
                      return (
                        <line
                          key={`${row.commit.hash}-t-${h}`}
                          x1={laneX(j)}
                          y1={rowTop}
                          x2={dotX}
                          y2={rowMid}
                          stroke={color}
                          strokeWidth={1.5}
                          opacity={opacity}
                        />
                      )
                    }
                    return (
                      <path
                        key={`${row.commit.hash}-t-${h}`}
                        d={`M${laneX(j)},${rowTop} C${laneX(j)},${rowMid - ROW_H / 4} ${dotX},${rowMid - ROW_H / 4} ${dotX},${rowMid}`}
                        stroke={color}
                        strokeWidth={1.5}
                        fill="none"
                        opacity={opacity}
                      />
                    )
                  }
                  return (
                    <line
                      key={`${row.commit.hash}-t-${h}`}
                      x1={laneX(j)}
                      y1={rowTop}
                      x2={laneX(j)}
                      y2={rowMid}
                      stroke={color}
                      strokeWidth={1.5}
                      opacity={opacity}
                    />
                  )
                })

                const parentSet = new Set(row.commit.parents)
                const opacity = dim ? 0.2 : 0.85
                const bottomEdges: ReactNode[] = []

                // Vertical/curve for each lane leaving this row. Passthrough
                // lanes (same hash entering and leaving) continue straight; a
                // lane newly created at this row originates at the commit dot.
                row.outgoing.forEach((h, j) => {
                  if (h === null) return
                  const color = laneColor(j)
                  const pass = row.incoming[j] === h
                  if (pass) {
                    bottomEdges.push(
                      <line
                        key={`${row.commit.hash}-b-${h}`}
                        x1={laneX(j)}
                        y1={rowMid}
                        x2={laneX(j)}
                        y2={rowBot}
                        stroke={color}
                        strokeWidth={1.5}
                        opacity={opacity}
                      />
                    )
                    return
                  }
                  const endX = laneX(j)
                  if (dotX === endX) {
                    bottomEdges.push(
                      <line
                        key={`${row.commit.hash}-b-${h}`}
                        x1={endX}
                        y1={rowMid}
                        x2={endX}
                        y2={rowBot}
                        stroke={color}
                        strokeWidth={1.5}
                        opacity={opacity}
                      />
                    )
                  } else {
                    bottomEdges.push(
                      <path
                        key={`${row.commit.hash}-b-${h}`}
                        d={`M${dotX},${rowMid} C${dotX},${rowMid + ROW_H / 4} ${endX},${rowMid + ROW_H / 4} ${endX},${rowBot}`}
                        stroke={color}
                        strokeWidth={1.5}
                        fill="none"
                        opacity={opacity}
                      />
                    )
                  }
                })

                // Extra commit→parent curves for parents that were already in
                // an existing lane before this row (passthrough above only drew
                // the vertical — we still need to visually connect the dot).
                for (const p of row.commit.parents) {
                  const j = row.outgoing.indexOf(p)
                  if (j === -1 || j === row.commitLane) continue
                  if (row.incoming[j] !== p) continue
                  if (!parentSet.has(row.outgoing[j] ?? '')) continue
                  const endX = laneX(j)
                  bottomEdges.push(
                    <path
                      key={`${row.commit.hash}-merge-${p}`}
                      d={`M${dotX},${rowMid} C${dotX},${rowMid + ROW_H / 4} ${endX},${rowMid + ROW_H / 4} ${endX},${rowBot}`}
                      stroke={laneColor(j)}
                      strokeWidth={1.5}
                      fill="none"
                      opacity={opacity}
                    />
                  )
                }

                const isMerge = row.commit.parents.length >= 2
                const dot = isMerge ? (
                  <circle
                    key={`${row.commit.hash}-dot`}
                    cx={dotX}
                    cy={rowMid}
                    r={4}
                    fill="var(--background)"
                    stroke="var(--merge)"
                    strokeWidth={1.6}
                    opacity={dim ? 0.25 : 0.95}
                  />
                ) : (
                  <circle
                    key={`${row.commit.hash}-dot`}
                    cx={dotX}
                    cy={rowMid}
                    r={DOT_R}
                    fill={laneColor(row.commitLane)}
                    opacity={dim ? 0.25 : 1}
                  />
                )

                return (
                  <g key={`row-${row.commit.hash}`}>
                    {topEdges}
                    {bottomEdges}
                    {dot}
                  </g>
                )
              })}
            </svg>

            <ul style={{ height: totalHeight }} className="relative">
              {rows.map((row) => {
                const c = row.commit
                const hov = hovered === c.hash
                const dim = visibleSet && !visibleSet.has(c.hash)
                const isMerge = c.parents.length >= 2
                const refs = parseRefs(c.refs)
                return (
                  <li
                    key={c.hash}
                    onMouseEnter={() => setHovered(c.hash)}
                    onMouseLeave={() => setHovered(null)}
                    className="grid items-center gap-3 px-0"
                    style={{
                      height: ROW_H,
                      gridTemplateColumns: gridTemplate,
                      backgroundColor: hov ? 'var(--accent)' : 'transparent',
                      transition: 'background-color 60ms ease',
                      opacity: dim ? 0.35 : 1
                    }}
                  >
                    <span aria-hidden />
                    <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                      {refs.map((r) => (
                        <span
                          key={`${r.kind}:${r.label}`}
                          className={`inline-flex h-4 shrink-0 items-center rounded-sm border px-1.5 text-xs ${refClass(r.kind)}`}
                          title={r.kind}
                        >
                          {r.label}
                        </span>
                      ))}
                      <span className="min-w-0 truncate">{c.message}</span>
                      {isMerge && (
                        <span
                          className="inline-flex h-4 shrink-0 items-center rounded-sm border border-border px-1.5 text-xs text-[color:var(--merge)]"
                          title="merge commit"
                        >
                          merge
                        </span>
                      )}
                    </span>

                    <span
                      className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
                      title={c.author_name}
                    >
                      <span
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground/70"
                        aria-hidden
                      >
                        {initials(c.author_name)}
                      </span>
                      <span className="min-w-0 truncate">{c.author_name}</span>
                    </span>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <time className="cursor-default truncate text-xs tabular-nums text-muted-foreground/70">
                          {formatCommitDate(c.date)}
                        </time>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {new Date(c.date).toLocaleString()}
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <code className="cursor-default truncate pr-3 text-right text-xs tabular-nums text-muted-foreground/70">
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
