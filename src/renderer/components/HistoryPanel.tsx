import { GitMerge, Loader2 } from 'lucide-react'
import {
  memo,
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
  defaultBranch?: string
}

function getRootFontPx(): number {
  if (typeof document === 'undefined') return 16
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(fs) && fs > 0 ? fs : 16
}
const ROOT_PX = getRootFontPx()

const ROW_H = Math.round(ROOT_PX * 2)
const COL_W = Math.round(ROOT_PX)
const RAIL_PAD = Math.round(ROOT_PX * 0.875)
const DOT_R = ROOT_PX * 0.25
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
      if (part.startsWith('HEAD -> ')) return { label: part.slice(8), kind: 'branch' }
      if (part === 'HEAD') return null
      if (part.startsWith('tag: ')) return { label: part.slice(5), kind: 'tag' }
      if (/^stash@\{/.test(part)) return { label: part, kind: 'stash' }
      if (part.includes('/')) {
        const first = part.slice(0, part.indexOf('/'))
        const haveRemotes = remoteNames && remoteNames.size > 0
        const isRemote = haveRemotes ? remoteNames.has(first) : first === 'origin'
        if (isRemote) {
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
  lanesAfter: (string | null)[]
  commits: GitLogEntry[]
  trunkHash?: string
  trunkRowIdx: number
}

export function layoutCommits(
  commits: GitLogEntry[],
  prev?: LayoutResult,
  trunkHash?: string
): LayoutResult {
  let startIdx = 0
  let lanes: (string | null)[] = []
  let rows: RowLayout[] = []
  let maxLanes = 0
  let trunkRowIdx = -1

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
    trunkRowIdx = prev.trunkRowIdx
  } else if (trunkHash) {
    lanes = [trunkHash]
    maxLanes = 1
  }

  for (let idx = startIdx; idx < commits.length; idx++) {
    const c = commits[idx]
    if (trunkRowIdx === -1 && trunkHash && c.hash === trunkHash) {
      trunkRowIdx = idx
    }
    const incoming = [...lanes]

    let commitLane = lanes.indexOf(c.hash)
    if (commitLane === -1) {
      commitLane = lanes.indexOf(null)
      if (commitLane === -1) {
        commitLane = lanes.length
        lanes.push(null)
      }
    }

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

  return { rows, maxLanes, lanesAfter: lanes, commits, trunkHash, trunkRowIdx }
}

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
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const deferredLog = useDeferredValue(log)
  const deferredFilter = useDeferredValue(filter)
  const commits: GitLogEntry[] = deferredLog?.all ?? []

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

  const layoutCacheRef = useRef<LayoutResult | null>(null)
  const { rows, trunkRowIdx } = useMemo(() => {
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      if (el.clientHeight > 0) setViewportH(el.clientHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const endIdx = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)

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

  const [themeNonce, setThemeNonce] = useState(0)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const mo = new MutationObserver(() => setThemeNonce((n) => n + 1))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const drawDataRef = useRef({ rows, viewportH, visibleSet, railWidth, trunkRowIdx, trunkHash })
  drawDataRef.current = { rows, viewportH, visibleSet, railWidth, trunkRowIdx, trunkHash }

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const scroller = scrollRef.current
    if (!canvas || !scroller) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const {
      rows: rs,
      viewportH: vh,
      visibleSet: vis,
      railWidth: rw,
      trunkRowIdx: trunkIdx,
      trunkHash: trunk
    } = drawDataRef.current
    const liveScrollTop = scroller.scrollTop

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const bitmapW = Math.max(1, Math.round(rw * dpr))
    const bitmapH = Math.max(1, Math.round(vh * dpr))
    if (canvas.width !== bitmapW) canvas.width = bitmapW
    if (canvas.height !== bitmapH) canvas.height = bitmapH

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rw, vh)
    ctx.lineCap = 'round'

    const bgColor = readCssVar('--color-background', '#ffffff')
    const mergeColor = readCssVar('--color-chart-3', '#f59e0b')

    const start = Math.max(0, Math.floor(liveScrollTop / ROW_H) - OVERSCAN)
    const end = Math.min(rs.length, Math.ceil((liveScrollTop + vh) / ROW_H) + OVERSCAN)

    for (let i = start; i < end; i++) {
      const r = rs[i]
      if (!r) continue
      const yTop = i * ROW_H - liveScrollTop
      if (yTop + ROW_H < 0 || yTop > vh) continue
      const dim = !!(vis && !vis.has(r.commit.hash))

      let drawRow = r
      if (trunkIdx >= 0 && trunk && i <= trunkIdx) {
        const hideTop = r.incoming[0] === trunk
        const hideBot = i < trunkIdx && r.outgoing[0] === trunk
        if (hideTop || hideBot) {
          drawRow = {
            ...r,
            incoming: hideTop ? [null, ...r.incoming.slice(1)] : r.incoming,
            outgoing: hideBot ? [null, ...r.outgoing.slice(1)] : r.outgoing
          }
        }
      }

      drawGraphRow(ctx, drawRow, yTop, i === 0, dim, bgColor, mergeColor)
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: themeNonce drives the redraw when CSS vars change even though it isn't read directly
  useEffect(() => {
    drawCanvas()
  }, [rows, viewportH, visibleSet, railWidth, themeNonce, drawCanvas])

  const rafRef = useRef<number | null>(null)
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        drawCanvas()
        setScrollTop(target.scrollTop)
      })
    },
    [drawCanvas]
  )
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    []
  )

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

  const gridTemplate = `${railWidth}px minmax(7rem,1fr) ${colWidths.author}rem ${colWidths.date}rem ${colWidths.sha}rem`

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

            <div
              className="pointer-events-none sticky top-0 z-20"
              style={{ height: 0 }}
              aria-hidden
            >
              <canvas
                ref={canvasRef}
                className="absolute left-0 top-0"
                style={{ width: railWidth, height: viewportH }}
              />
            </div>
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

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function drawGraphRow(
  ctx: CanvasRenderingContext2D,
  row: RowLayout,
  yTop: number,
  isFirst: boolean,
  dim: boolean,
  bgColor: string,
  mergeColor: string
): void {
  const rowMid = yTop + ROW_H / 2
  const rowBot = yTop + ROW_H
  const dotX = laneX(row.commitLane)
  const edgeAlpha = dim ? 0.2 : 0.85

  ctx.lineWidth = 1.5
  ctx.globalAlpha = edgeAlpha

  if (!isFirst) {
    for (let j = 0; j < row.incoming.length; j++) {
      const h = row.incoming[j]
      if (h === null) continue
      ctx.strokeStyle = laneColor(j)
      if (h === row.commit.hash) {
        if (j === row.commitLane) {
          ctx.beginPath()
          ctx.moveTo(laneX(j), yTop)
          ctx.lineTo(dotX, rowMid)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(laneX(j), yTop)
          ctx.bezierCurveTo(laneX(j), rowMid - ROW_H / 4, dotX, rowMid - ROW_H / 4, dotX, rowMid)
          ctx.stroke()
        }
      } else {
        ctx.beginPath()
        ctx.moveTo(laneX(j), yTop)
        ctx.lineTo(laneX(j), rowMid)
        ctx.stroke()
      }
    }
  }

  for (let j = 0; j < row.outgoing.length; j++) {
    const h = row.outgoing[j]
    if (h === null) continue
    ctx.strokeStyle = laneColor(j)
    const pass = row.incoming[j] === h
    if (pass) {
      ctx.beginPath()
      ctx.moveTo(laneX(j), rowMid)
      ctx.lineTo(laneX(j), rowBot)
      ctx.stroke()
      continue
    }
    const endX = laneX(j)
    if (dotX === endX) {
      ctx.beginPath()
      ctx.moveTo(endX, rowMid)
      ctx.lineTo(endX, rowBot)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(dotX, rowMid)
      ctx.bezierCurveTo(dotX, rowMid + ROW_H / 4, endX, rowMid + ROW_H / 4, endX, rowBot)
      ctx.stroke()
    }
  }

  const parentSet = new Set(row.commit.parents)
  for (const p of row.commit.parents) {
    const j = row.outgoing.indexOf(p)
    if (j === -1 || j === row.commitLane) continue
    if (row.incoming[j] !== p) continue
    if (!parentSet.has(row.outgoing[j] ?? '')) continue
    const endX = laneX(j)
    ctx.strokeStyle = laneColor(j)
    ctx.beginPath()
    ctx.moveTo(dotX, rowMid)
    ctx.bezierCurveTo(dotX, rowMid + ROW_H / 4, endX, rowMid + ROW_H / 4, endX, rowBot)
    ctx.stroke()
  }

  const isMerge = row.commit.parents.length >= 2
  if (isMerge) {
    ctx.globalAlpha = dim ? 0.25 : 0.95
    ctx.beginPath()
    ctx.arc(dotX, rowMid, 4, 0, Math.PI * 2)
    ctx.fillStyle = bgColor
    ctx.fill()
    ctx.strokeStyle = mergeColor
    ctx.lineWidth = 1.6
    ctx.stroke()
  } else {
    ctx.globalAlpha = dim ? 0.25 : 1
    ctx.beginPath()
    ctx.arc(dotX, rowMid, DOT_R, 0, Math.PI * 2)
    ctx.fillStyle = laneColor(row.commitLane)
    ctx.fill()
  }
}

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
      className="group/row absolute inset-x-0 z-10 grid items-center gap-1 bg-card px-0 hover:bg-muted"
      style={{
        top: 0,
        height: ROW_H,
        transform: `translateY(${i * ROW_H}px)`,
        gridTemplateColumns: 'var(--row-cols)',
        opacity: dim ? 0.35 : 1,
        contain: 'layout paint style'
      }}
    >
      <span aria-hidden />
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
