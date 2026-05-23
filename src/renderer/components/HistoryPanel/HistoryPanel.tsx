import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useThemeNonce } from '@/hooks/useThemeNonce'
import { useVirtualList } from '@/hooks/useVirtualList'
import {
  computeRowRailWidth,
  COL_W as GRAPH_COL_W,
  OVERSCAN,
  RAIL_PAD,
  ROW_H
} from '@/lib/git-graph/canvas'
import { type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
import type { GitLog, GitLogEntry } from '@/types'
import { CommitGraphCanvas, type CommitGraphCanvasHandle } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import { HistoryHeader } from './HistoryHeader'
import { SkeletonRows } from './SkeletonRows'
import { computeOnBranchSet, computeVisibleSet } from './selectors'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
  remotes?: Record<string, string>
  currentBranch?: string
}

const COL_AUTHOR_REM = 12
const COL_SHA_REM = 4.5
const COL_DATE_REM = 6.5

export function HistoryPanel({ log, loading, remotes = {}, currentBranch }: HistoryPanelProps) {
  const [filter, setFilter] = useState('')
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const deferredLog = useDeferredValue(log)
  const deferredFilter = useDeferredValue(filter)
  const commits: GitLogEntry[] = deferredLog?.all ?? []

  const onBranchSet = useMemo(
    () => computeOnBranchSet(commits, remoteNames, currentBranch),
    [commits, remoteNames, currentBranch]
  )

  const layoutCacheRef = useRef<LayoutResult | null>(null)
  const { rows } = useMemo(() => {
    const result = layoutCommits(commits, layoutCacheRef.current ?? undefined)
    layoutCacheRef.current = result
    return result
  }, [commits])

  const visibleSet = useMemo(
    () => computeVisibleSet(deferredFilter, commits),
    [deferredFilter, commits]
  )

  const canvasHandleRef = useRef<CommitGraphCanvasHandle>(null)
  const onScrollFrame = useCallback(() => {
    canvasHandleRef.current?.redraw()
  }, [])

  const { scrollRef, onScroll, viewportHeight, startIndex, endIndex, totalHeight, scrollTop } =
    useVirtualList({
      rowCount: rows.length,
      rowHeight: ROW_H,
      overscan: OVERSCAN,
      onScrollFrame
    })

  const localMaxLanes = useMemo(() => {
    let max = 0
    for (let i = startIndex; i < endIndex; i++) {
      const row = rows[i]
      if (!row) continue
      const candidate = Math.max(row.incoming.length, row.outgoing.length, row.commitLane + 1)
      if (candidate > max) max = candidate
    }
    return max
  }, [rows, startIndex, endIndex])
  const railWidth = Math.max(28, RAIL_PAD * 2 + Math.max(localMaxLanes - 1, 0) * GRAPH_COL_W)

  const themeNonce = useThemeNonce()

  const gridTemplate = `minmax(0,1fr) ${COL_AUTHOR_REM}rem ${COL_SHA_REM}rem ${COL_DATE_REM}rem`

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card">
      <HistoryHeader
        total={log?.total}
        loading={loading}
        filter={filter}
        onFilterChange={setFilter}
        showFilter={commits.length > 0}
      />

      {commits.length > 0 && (
        <div
          className="grid h-7 shrink-0 items-center gap-1 border-b bg-muted/30 px-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span className="pl-3">Subject</span>
          <span>Author</span>
          <span>SHA</span>
          <span className="pr-3 text-right">Date</span>
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
            <SkeletonRows gridTemplate={gridTemplate} viewportHeight={viewportHeight} />
          ) : (
            <EmptyState />
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
            {loading && (
              <LoadingOverlay
                totalHeight={totalHeight}
                scrollTop={scrollTop}
                viewportHeight={viewportHeight}
                gridTemplate={gridTemplate}
              />
            )}

            <CommitGraphCanvas
              ref={canvasHandleRef}
              rows={rows}
              scrollContainerRef={scrollRef}
              viewportHeight={viewportHeight}
              visibleSet={visibleSet}
              railWidth={railWidth}
              themeNonce={themeNonce}
            />

            {rows.slice(startIndex, endIndex).map((row, idx) => {
              const i = startIndex + idx
              const dim = !!(visibleSet && !visibleSet.has(row.commit.hash))
              const offBranch = !!(onBranchSet && !onBranchSet.has(row.commit.hash))
              return (
                <CommitRow
                  key={row.commit.hash}
                  row={row}
                  index={i}
                  dim={dim}
                  offBranch={offBranch}
                  rowRailWidth={computeRowRailWidth(row)}
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

function LoadingOverlay({
  totalHeight,
  scrollTop,
  viewportHeight,
  gridTemplate
}: {
  totalHeight: number
  scrollTop: number
  viewportHeight: number
  gridTemplate: string
}) {
  const visibleBelow = Math.max(0, totalHeight - scrollTop)
  const overlayHeight = Math.min(viewportHeight, visibleBelow)
  if (overlayHeight <= 0) return null
  return (
    <div className="pointer-events-none sticky top-0 z-0" style={{ height: 0 }} aria-hidden>
      <div className="absolute inset-x-0 top-0 overflow-hidden" style={{ height: overlayHeight }}>
        <SkeletonRows gridTemplate={gridTemplate} viewportHeight={overlayHeight} />
      </div>
    </div>
  )
}

function EmptyState() {
  return (
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
}
