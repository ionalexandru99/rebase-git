import { GitMerge, Loader2 } from 'lucide-react'
import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { RemoteProviderIcon } from '@/components/RemoteProviderIcon'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { GitLog, GitLogEntry } from '../types'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
  remotes?: Record<string, string>
  // Branch name treated as trunk. Resolved by the main process from
  // `origin/HEAD` (canonical) with a fallback to the locally checked-out
  // branch — works for repos using `main`, `master`, `dev`, `trunk`, etc.
  defaultBranch?: string
}

// Derive layout constants from the current root font size so the row pitch,
// lane spacing, and dot size scale together if the root changes (index.css).
function getRootFontPx(): number {
  if (typeof document === 'undefined') return 16
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(fs) && fs > 0 ? fs : 16
}
const ROOT_PX = getRootFontPx()

const ROW_H = Math.round(ROOT_PX * 2) // 32 at 16px root
const COL_W = Math.round(ROOT_PX) // 16
const RAIL_PAD = Math.round(ROOT_PX * 0.875) // 14
const DOT_R = ROOT_PX * 0.25 // 4
// Number of rows to render outside the visible window in either direction.
// Sized to cover a scrollbar-drag jump of ~9600px (300 × 32) before React
// commits the next slice. Smaller buffers leave the viewport empty during
// fast flings; larger buffers cost more mount work per buffer-shift.
const OVERSCAN = 300

interface ColWidths {
  author: number
  date: number
  sha: number
}
const COL_DEFAULTS: ColWidths = { author: 14, date: 6, sha: 4.5 }
const COL_MIN = 3
const COL_MAX = 40
const COL_STORE_KEY = 'historyColWidths'

// Best-effort parse of whatever electron-store hands back. Guards against
// stale/older serialized shapes and bad numbers; missing fields fall back to
// the default.
function parseColWidths(v: unknown): ColWidths | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const clamp = (n: unknown, fallback: number): number => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
    return Math.max(COL_MIN, Math.min(COL_MAX, n))
  }
  return {
    author: clamp(r.author, COL_DEFAULTS.author),
    date: clamp(r.date, COL_DEFAULTS.date),
    sha: clamp(r.sha, COL_DEFAULTS.sha)
  }
}

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

// Remote refs like `origin/feature/x` split into `origin` + `feature/x`. The
// remote name is rendered as a provider icon (GitHub, GitLab, …) and the tail
// stays as the branch label.
function splitRemoteRef(label: string): { remote: string; branch: string } {
  const slash = label.indexOf('/')
  if (slash === -1) return { remote: label, branch: '' }
  return { remote: label.slice(0, slash), branch: label.slice(slash + 1) }
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

// Drops a remote `<remoteName>/X` when a local branch `X` is also present on
// the same commit — they point at the same SHA, so showing both is noise.
// Uses indexOf (first slash) because the local branch part is everything
// after the remote name, even if the branch itself contains slashes.
function dedupeRefs(parsed: ParsedRef[]): ParsedRef[] {
  const localNames = new Set(
    parsed.filter((r) => r.kind === 'branch' || r.kind === 'head').map((r) => r.label)
  )
  return parsed.filter((r) => {
    if (r.kind !== 'remote') return true
    const slash = r.label.indexOf('/')
    const branchName = slash === -1 ? r.label : r.label.slice(slash + 1)
    return !localNames.has(branchName)
  })
}

export function parseRefs(refs: string, remoteNames?: Set<string>): ParsedRef[] {
  if (!refs) return []
  const parsed = refs
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map<ParsedRef | null>((part) => {
      // `HEAD -> X` collapses into a plain branch pill — the active branch is
      // already inferable from the topbar, no need for a separate HEAD chip.
      // Bare `HEAD` (detached) is dropped entirely.
      if (part.startsWith('HEAD -> ')) return { label: part.slice(8), kind: 'branch' }
      if (part === 'HEAD') return null
      if (part.startsWith('tag: ')) return { label: part.slice(5), kind: 'tag' }
      if (/^stash@\{/.test(part)) return { label: part, kind: 'stash' }
      // A ref is "remote" iff its first path segment matches a known remote.
      // If we don't have the remote list yet (tests, initial render), fall
      // back to first-segment-equals-"origin" — covers the common case
      // without misclassifying local branches that happen to contain `/`.
      if (part.includes('/')) {
        const first = part.slice(0, part.indexOf('/'))
        const haveRemotes = remoteNames && remoteNames.size > 0
        const isRemote = haveRemotes ? remoteNames.has(first) : first === 'origin'
        if (isRemote) {
          // Drop `<remote>/HEAD` symrefs — they're metadata pointing at the
          // remote's default branch, not a branch the user wants to see.
          if (part.slice(first.length + 1) === 'HEAD') return null
          return { label: part, kind: 'remote' }
        }
      }
      return { label: part, kind: 'branch' }
    })
    .filter((r): r is ParsedRef => r !== null)
  return dedupeRefs(parsed)
}

interface RowLayout {
  commit: GitLogEntry
  commitLane: number
  incoming: (string | null)[]
  outgoing: (string | null)[]
}

export interface LayoutResult {
  rows: RowLayout[]
  maxLanes: number
  // Lane state at the end of the walk. Persisted so a follow-up streaming
  // chunk can resume without re-walking from the first commit.
  lanesAfter: (string | null)[]
  // The exact input array layoutCommits was called with. Used by `prev` to
  // confirm the new input extends the cached one (same prefix).
  commits: GitLogEntry[]
  // Hash that was pre-seeded onto lane 0 (typically the main/master/HEAD
  // tip). Cache invalidates when this changes between calls.
  trunkHash?: string
}

// Compute per-row lane state by walking commits in display order.
// Each lane "waits" for a specific parent hash. When a commit matches one of
// the waiting hashes, its dot occupies that lane; otherwise it gets a fresh
// lane (first null slot, else appended).
//
// Incremental mode: pass the previous result as `prev`. If `commits` extends
// it (cheap prefix check via first + last cached hashes), the walk resumes
// from where `prev` ended — useful while the streaming log is still flowing.
//
// `trunkHash`: if provided, lane 0 is reserved for this commit so its
// first-parent trail anchors the leftmost rail regardless of date-order.
export function layoutCommits(
  commits: GitLogEntry[],
  prev?: LayoutResult,
  trunkHash?: string
): LayoutResult {
  let startIdx = 0
  let lanes: (string | null)[] = []
  let rows: RowLayout[] = []
  let maxLanes = 0

  if (
    prev &&
    prev.trunkHash === trunkHash &&
    prev.commits.length > 0 &&
    commits.length >= prev.commits.length &&
    commits[0]?.hash === prev.commits[0]?.hash &&
    commits[prev.commits.length - 1]?.hash === prev.commits[prev.commits.length - 1]?.hash
  ) {
    startIdx = prev.commits.length
    lanes = prev.lanesAfter.slice()
    rows = prev.rows.slice()
    maxLanes = prev.maxLanes
  } else if (trunkHash) {
    lanes = [trunkHash]
    maxLanes = 1
  }

  for (let idx = startIdx; idx < commits.length; idx++) {
    const c = commits[idx]
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

  return { rows, maxLanes, lanesAfter: lanes, commits, trunkHash }
}

// Branch-type pills (HEAD, branch, remote) borrow the commit's lane color so
// they visually belong to the lane. The alpha steps differentiate role:
// HEAD = strongest, branch = medium, remote = outline-only. Tag/stash keep
// semantic palettes since they aren't part of branch flow.
function refClass(kind: ParsedRef['kind']): string {
  switch (kind) {
    case 'remote':
      return 'border-border bg-muted/60 text-muted-foreground'
    case 'tag':
      return 'border-chart-3/50 bg-chart-3/20 text-chart-3'
    case 'stash':
      return 'border-amber-500/50 bg-amber-500/20 text-amber-600 dark:text-amber-400'
    default:
      return ''
  }
}

function pillStyle(kind: ParsedRef['kind'], laneHex: string): React.CSSProperties | undefined {
  // Only local branch pills borrow the lane color. Remote, tag, and stash
  // pills keep their neutral / semantic chrome so the visual emphasis stays
  // on "what's at this commit in MY working copy".
  if (kind === 'branch') {
    return {
      borderColor: `${laneHex}66`,
      backgroundColor: `${laneHex}1f`,
      color: laneHex
    }
  }
  return undefined
}

export function HistoryPanel({ log, loading, remotes = {}, defaultBranch }: HistoryPanelProps) {
  const [filter, setFilter] = useState('')
  // Memoized so CommitRow's memo equality on `remoteNames` stays stable.
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  // Defer the heavy work (layoutCommits + filter walk) so typing in the filter
  // input and arrival of a fresh log don't block paint. React keeps the
  // previous derived state visible until the new one is ready.
  const deferredLog = useDeferredValue(log)
  const deferredFilter = useDeferredValue(filter)
  const commits: GitLogEntry[] = deferredLog?.all ?? []

  // Resolve the "trunk" commit — the tip of `defaultBranch`. Anchors lane 0
  // so the team's primary branch (whether `main`, `master`, `dev`, `trunk`,
  // etc.) sits on the leftmost rail regardless of date order.
  //
  // Only decorated commits have a non-empty refs string, so this loop
  // short-circuits on the vast majority of entries even in a 76k-commit log.
  const trunkHash = useMemo(() => {
    if (!defaultBranch) return undefined
    for (const c of commits) {
      if (!c.refs) continue
      if (!c.refs.includes(defaultBranch)) continue
      const parsed = parseRefs(c.refs, remoteNames)
      if (parsed.some((r) => r.kind === 'branch' && r.label === defaultBranch)) {
        return c.hash
      }
    }
    return undefined
  }, [commits, remoteNames, defaultBranch])

  // Layout cache: streaming log chunks each produce a fresh `commits` array
  // that extends the previous one. The ref lets layoutCommits walk only the
  // new tail. Invalidates automatically when commits[0]/last hash diverges
  // (e.g. repo switch, history rewrite) or when trunkHash changes (e.g. main
  // ref arrives in a later chunk).
  const layoutCacheRef = useRef<LayoutResult | null>(null)
  const { rows } = useMemo(() => {
    const result = layoutCommits(commits, layoutCacheRef.current ?? undefined, trunkHash)
    layoutCacheRef.current = result
    return result
  }, [commits, trunkHash])

  const visibleSet = useMemo(() => {
    const q = deferredFilter.trim().toLowerCase()
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
  }, [deferredFilter, commits])

  const totalHeight = rows.length * ROW_H

  // Virtualization: track scroll position + viewport height of the list
  // container, and only render rows in [startIdx, endIdx). We initialize
  // viewportH to window.innerHeight so the first render already paints close
  // to the right window — the post-mount measurement just refines it.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      // 0 means jsdom / pre-layout — keep the existing fallback so tests still
      // see rows rendered.
      if (el.clientHeight > 0) setViewportH(el.clientHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rafRef = useRef<number | null>(null)
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      setScrollTop(target.scrollTop)
    })
  }, [])
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)

  // Rail width tracks the max lane count *currently in the rendered buffer*.
  // When you scroll into a complex merge region the graph widens; when you
  // scroll into linear history it narrows and the subject column reclaims the
  // space. The buffer includes overscan so the width doesn't jitter on every
  // row that enters or leaves the strict viewport.
  const localMaxLanes = useMemo(() => {
    let max = 0
    for (let i = startIdx; i < endIdx; i++) {
      const r = rows[i]
      if (!r) continue
      const m = Math.max(r.incoming.length, r.outgoing.length, r.commitLane + 1)
      if (m > max) max = m
    }
    return max
  }, [rows, startIdx, endIdx])
  const railWidth = Math.max(28, RAIL_PAD * 2 + Math.max(localMaxLanes - 1, 0) * COL_W)

  // User-resizable column widths (in rem). Subject is `1fr` and auto-fills
  // whatever's left. Drag the handles on the column header to resize. The
  // last-committed widths are persisted via electron-store; we load them on
  // mount and write back once at drag end (not every mousemove).
  const [colWidths, setColWidths] = useState(COL_DEFAULTS)

  useEffect(() => {
    let cancelled = false
    Promise.resolve(window.electronAPI.getStoreValue(COL_STORE_KEY)).then((v) => {
      if (cancelled) return
      const parsed = parseColWidths(v)
      if (parsed) setColWidths(parsed)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Graph is auto-sized to the visible lane count (left-pinned). Author/Date/
  // SHA are user-resizable fixed widths pinned to the right. Subject takes
  // whatever space is left in between — the only flexible column.
  const gridTemplate = `${railWidth}px minmax(7rem,1fr) ${colWidths.author}rem ${colWidths.date}rem ${colWidths.sha}rem`

  // Resize the boundary between two columns. Drag right: leftCol grows,
  // rightCol shrinks. Either side may be `null` to model:
  //   - `leftCol=null` → the flexible Subject (1fr) is to the left.
  //     Rightward drag still shrinks rightCol; Subject auto-absorbs.
  //   - `rightCol=null` → the panel edge is to the right (e.g. SHA's right
  //     edge). Rightward drag grows leftCol; Subject (1fr) absorbs from the
  //     other side.
  const startBoundaryResize = useCallback(
    (leftCol: keyof ColWidths | null, rightCol: keyof ColWidths | null, e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startLeft = leftCol ? colWidths[leftCol] : 0
      const startRight = rightCol ? colWidths[rightCol] : 0
      let last = { ...colWidths }
      const onMove = (ev: MouseEvent) => {
        const deltaRem = (ev.clientX - startX) / ROOT_PX
        const update: Partial<ColWidths> = {}
        if (leftCol) {
          update[leftCol] = Math.max(COL_MIN, Math.min(COL_MAX, startLeft + deltaRem))
        }
        if (rightCol) {
          update[rightCol] = Math.max(COL_MIN, Math.min(COL_MAX, startRight - deltaRem))
        }
        last = { ...last, ...update }
        setColWidths(last)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.electronAPI.setStoreValue(COL_STORE_KEY, last)
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [colWidths]
  )

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b px-3">
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
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter commits…"
              className="h-7 w-40"
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
          className="grid h-7 shrink-0 items-center gap-1 border-b bg-muted/30 px-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span aria-hidden />
          <span className="relative pl-3">
            Subject
            <ColResizer onMouseDown={(e) => startBoundaryResize(null, 'author', e)} />
          </span>
          <span className="relative">
            Author
            <ColResizer onMouseDown={(e) => startBoundaryResize('author', 'date', e)} />
          </span>
          <span className="relative">
            Date
            <ColResizer onMouseDown={(e) => startBoundaryResize('date', 'sha', e)} />
          </span>
          <span className="relative pr-3 text-right">
            SHA
            <ColResizer onMouseDown={(e) => startBoundaryResize('sha', null, e)} />
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto"
        data-testid="history-scroll"
      >
        {!log || commits.length === 0 ? (
          loading ? (
            <SkeletonRows gridTemplate={gridTemplate} viewportH={viewportH} />
          ) : (
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
          )
        ) : (
          <div
            className="relative"
            style={
              {
                height: totalHeight,
                '--row-cols': gridTemplate
              } as React.CSSProperties
            }
          >
            {/* Sticky fallback that fills the viewport whenever real rows
                haven't caught up with the scroll position. Zero-height in the
                normal flow so it doesn't offset row coordinates; its inner
                absolute child paints over the visible window. We clip the
                child to `totalHeight - scrollTop` so on short histories the
                skeleton never paints below the last commit (and never
                inflates scrollHeight past the data). */}
            {(() => {
              const visibleBelow = Math.max(0, totalHeight - scrollTop)
              const overlayH = Math.min(viewportH, visibleBelow)
              if (overlayH <= 0) return null
              return (
                <div
                  className="pointer-events-none sticky top-0 z-0"
                  style={{ height: 0 }}
                  aria-hidden
                >
                  <div
                    className="absolute inset-x-0 top-0 overflow-hidden"
                    style={{ height: overlayH }}
                  >
                    <SkeletonRows gridTemplate={gridTemplate} viewportH={overlayH} />
                  </div>
                </div>
              )
            })()}
            {rows.slice(startIdx, endIdx).map((row, idx) => {
              const i = startIdx + idx
              const dim = !!(visibleSet && !visibleSet.has(row.commit.hash))
              return (
                <CommitRow
                  key={row.commit.hash}
                  row={row}
                  i={i}
                  dim={dim}
                  remotes={remotes}
                  remoteNames={remoteNames}
                />
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// Per-row SVG graph segment. Memoized so that a scroll-induced re-render of
// HistoryPanel doesn't reconcile the SVG content for rows whose props haven't
// changed. Each row owns its own <svg> sized to ROW_H — small layers paint
// cheaply, unlike a single timeline-sized SVG which forces Chromium to manage
// a huge composited surface.
const GraphRow = memo(function GraphRow({
  row,
  dim,
  isFirst
}: {
  row: RowLayout
  dim: boolean
  // True for the absolute first row of the timeline (newest commit). Suppresses
  // the top half of the rail — there are no prior commits feeding into it, so
  // any pre-seeded lane state (trunk anchor) is synthetic, not a real edge.
  isFirst: boolean
}) {
  const rowTop = 0
  const rowMid = ROW_H / 2
  const rowBot = ROW_H
  const dotX = laneX(row.commitLane)

  // SVG edges within a row are keyed by their lane index because lanes don't
  // reorder; the index IS the stable identity here. We use a small helper to
  // bypass the index-as-key lint without scattering suppressions.
  const laneKey = (prefix: string, lane: number, h: string | null) =>
    `${prefix}_${row.commit.hash}_${lane}_${h ?? 'n'}`

  const topEdges = isFirst
    ? []
    : row.incoming.map((h, j) => {
        if (h === null) return null
        const color = laneColor(j)
        const opacity = dim ? 0.2 : 0.85
        if (h === row.commit.hash) {
          if (j === row.commitLane) {
            return (
              <line
                key={laneKey('t', j, h)}
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
              key={laneKey('t', j, h)}
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
            key={laneKey('t', j, h)}
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

  row.outgoing.forEach((h, j) => {
    if (h === null) return
    const color = laneColor(j)
    const pass = row.incoming[j] === h
    if (pass) {
      bottomEdges.push(
        <line
          key={laneKey('b', j, h)}
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
          key={laneKey('b', j, h)}
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
          key={laneKey('b', j, h)}
          d={`M${dotX},${rowMid} C${dotX},${rowMid + ROW_H / 4} ${endX},${rowMid + ROW_H / 4} ${endX},${rowBot}`}
          stroke={color}
          strokeWidth={1.5}
          fill="none"
          opacity={opacity}
        />
      )
    }
  })

  for (const p of row.commit.parents) {
    const j = row.outgoing.indexOf(p)
    if (j === -1 || j === row.commitLane) continue
    if (row.incoming[j] !== p) continue
    if (!parentSet.has(row.outgoing[j] ?? '')) continue
    const endX = laneX(j)
    bottomEdges.push(
      <path
        key={`m-${p}`}
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
      cx={dotX}
      cy={rowMid}
      r={4}
      fill="var(--color-background)"
      stroke="var(--color-chart-3)"
      strokeWidth={1.6}
      opacity={dim ? 0.25 : 0.95}
    />
  ) : (
    <circle
      cx={dotX}
      cy={rowMid}
      r={DOT_R}
      fill={laneColor(row.commitLane)}
      opacity={dim ? 0.25 : 1}
    />
  )

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative rail; aria-hidden suffices
    <svg
      width="100%"
      height={ROW_H}
      className="pointer-events-none block"
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      {topEdges}
      {bottomEdges}
      {dot}
    </svg>
  )
})

// Per-row <li> content. Memoized: scrolling doesn't reconcile the spans for
// rows that stay in view; only rows entering/leaving the buffer mount/unmount.
const CommitRow = memo(function CommitRow({
  row,
  i,
  dim,
  remotes,
  remoteNames
}: {
  row: RowLayout
  i: number
  dim: boolean
  remotes: Record<string, string>
  remoteNames: Set<string>
}) {
  const c = row.commit
  const isMerge = c.parents.length >= 2
  const refs = useMemo(() => parseRefs(c.refs, remoteNames), [c.refs, remoteNames])
  const laneHex = laneColor(row.commitLane)
  return (
    <div
      className="group/row absolute inset-x-0 z-10 grid items-center gap-1 bg-card px-0 hover:bg-muted/40"
      style={{
        top: 0,
        height: ROW_H,
        transform: `translateY(${i * ROW_H}px)`,
        gridTemplateColumns: 'var(--row-cols)',
        opacity: dim ? 0.35 : 1,
        contain: 'layout paint style'
      }}
    >
      <GraphRow row={row} dim={dim} isFirst={i === 0} />
      <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
        {isMerge && (
          <GitMerge aria-label="merge commit" className="size-3 shrink-0 text-emerald-500" />
        )}
        {refs.map((r) => {
          const style = pillStyle(r.kind, laneHex)
          const base = 'h-6 shrink-0 rounded-md border px-2.5 text-xs font-medium tracking-tight'
          if (r.kind === 'remote') {
            const { remote, branch } = splitRemoteRef(r.label)
            return (
              <Badge
                key={`${r.kind}:${r.label}`}
                variant="outline"
                className={cn(base, 'gap-1.5', refClass(r.kind))}
                style={style}
                title={r.label}
              >
                <RemoteProviderIcon url={remotes[remote]} className="!size-3.5" />
                {branch}
              </Badge>
            )
          }
          return (
            <Badge
              key={`${r.kind}:${r.label}`}
              variant="outline"
              className={cn(base, refClass(r.kind))}
              style={style}
              title={r.label}
            >
              {r.label}
            </Badge>
          )
        })}
        <span className="min-w-0 truncate text-foreground">{c.message}</span>
      </span>

      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground/80">
          {initials(c.author_name)}
        </span>
        <span className="min-w-0 truncate">{c.author_name}</span>
      </span>

      <time className="truncate text-xs tabular-nums text-muted-foreground">
        {formatCommitDate(c.date)}
      </time>

      <code className="cursor-default truncate pr-2 text-right text-xs tabular-nums text-muted-foreground">
        {c.hash.slice(0, 7)}
      </code>
    </div>
  )
})

// Placeholder rows shown while the log is loading. Mirrors the real grid so
// the column layout doesn't jump when the data arrives. Renders enough rows
// to cover the actual viewport — looks like the timeline is filling in, not
// like a small header pinned to the top.
function SkeletonRows({ gridTemplate, viewportH }: { gridTemplate: string; viewportH: number }) {
  const count = Math.max(12, Math.ceil(viewportH / ROW_H) + 2)
  return (
    <ul aria-busy="true" aria-label="Loading commit history" className="px-0 py-1">
      {Array.from({ length: count }, (_, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
          key={i}
          className="grid items-center gap-1 px-0"
          style={{ height: ROW_H, gridTemplateColumns: gridTemplate }}
        >
          <span aria-hidden className="flex h-full items-center pl-3">
            <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          </span>
          <Skeleton
            className="h-3 rounded"
            // Vary widths slightly so the skeleton doesn't read as a single block.
            style={{ width: `${55 + ((i * 13) % 35)}%`, opacity: 0.7 }}
          />
          <Skeleton className="h-3 w-20 rounded" style={{ opacity: 0.55 }} />
          <Skeleton className="h-3 w-16 rounded" style={{ opacity: 0.5 }} />
          <span className="flex justify-end pr-3">
            <Skeleton className="h-3 w-12 rounded" style={{ opacity: 0.5 }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

// Thin invisible strip on the right edge of a column header. Cursor changes to
// col-resize on hover; mousedown begins a drag. Positioned absolute so it sits
// over the gridtemplate boundary without affecting the header layout.
// Drag handle for a History column. The hit area is wider than the visible
// divider so it's easy to grab; the divider itself is always rendered (faint
// vertical line) so users can see where they can drag, and it brightens on
// hover.
function ColResizer({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize handle; no keyboard equivalent
    <span
      onMouseDown={onMouseDown}
      className="group/resizer absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize select-none items-center justify-center"
    >
      <span className="block h-3 w-px bg-border group-hover/resizer:h-full group-hover/resizer:w-0.5 group-hover/resizer:bg-primary/70" />
    </span>
  )
}
