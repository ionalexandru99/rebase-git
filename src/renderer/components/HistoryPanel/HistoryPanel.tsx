import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CommitAction } from '@/lib/git-actions'
import { computeGraphRailWidth, OVERSCAN, ROW_H } from '@/lib/git-graph/canvas'
import type { RefKind } from '@/lib/ref-tree'
import type { GitLog, GitLogEntry } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { buildDisplayRows, useGraphLayout } from '../../hooks/useGraphLayout'
import { useThemeNonce } from '../../hooks/useThemeNonce'
import { EmptyState } from '../ui/empty-state'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import { FocusRail } from './FocusRail'
import { HistoryHeader } from './HistoryHeader'
import { SkeletonRows } from './SkeletonRows'
import {
  computeOnBranchSet,
  computeVisibleSet,
  countVisibleBranchRefs,
  mergeGlyphState
} from './selectors'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  remotes?: Record<string, string>
  currentBranch?: string
  remoteBranches?: string[]
  visibleBranchRefs?: ReadonlySet<string>
  filteredCommits?: GitLogEntry[]
  expandedMerges?: ReadonlySet<string>
  onToggleMergeExpansion?: (mergeHash: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  repoPath?: string | null
}

const COL_AUTHOR_REM = 12
const COL_SHA_REM = 4.5
const COL_DATE_REM = 7.5
const HISTORY_SCROLL_CACHE_LIMIT = 32
const historyScrollPositions = new Map<string, number>()

const EMPTY_COMMITS: GitLogEntry[] = []
const EMPTY_REMOTES: Record<string, string> = {}
const EMPTY_REF_SET: ReadonlySet<string> = new Set()

function rememberHistoryScroll(repoPath: string, scrollTop: number) {
  historyScrollPositions.delete(repoPath)
  historyScrollPositions.set(repoPath, scrollTop)
  while (historyScrollPositions.size > HISTORY_SCROLL_CACHE_LIMIT) {
    const oldest = historyScrollPositions.keys().next().value
    if (!oldest) {
      break
    }
    historyScrollPositions.delete(oldest)
  }
}

export function HistoryPanel(props: HistoryPanelProps) {
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)
  const remotes = props.remotes ?? EMPTY_REMOTES
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const allCommits = props.log?.all ?? EMPTY_COMMITS
  const visibleBranchRefs = props.visibleBranchRefs ?? EMPTY_REF_SET
  const expandedMerges = props.expandedMerges ?? EMPTY_REF_SET
  const remoteBranches = props.remoteBranches
  const commits = props.filteredCommits ?? EMPTY_COMMITS

  const displayedSet = useMemo(() => new Set(commits.map((commit) => commit.hash)), [commits])
  const loadedSet = useMemo(() => new Set(allCommits.map((commit) => commit.hash)), [allCommits])
  const isHiddenParent = useCallback(
    (hash: string) => loadedSet.has(hash) && !displayedSet.has(hash),
    [loadedSet, displayedSet]
  )

  const visibleBranchCount = useMemo(
    () => countVisibleBranchRefs(visibleBranchRefs, remoteBranches, remoteNames),
    [visibleBranchRefs, remoteBranches, remoteNames]
  )

  const currentBranch = props.currentBranch
  const onCurrentBranchSet = useMemo(
    () => computeOnBranchSet(allCommits, remoteNames, currentBranch),
    [allCommits, remoteNames, currentBranch]
  )

  const graphLayout = useGraphLayout({
    commits,
    loading: props.loading || !!props.loadingMore,
    enabled: commits.length > 0,
    isHiddenParent
  })
  const layout = graphLayout.layout
  const laidOutThroughIndex = graphLayout.laidOutThroughIndex

  const rows = useMemo(
    () => buildDisplayRows(commits, layout, laidOutThroughIndex),
    [commits, layout, laidOutThroughIndex]
  )

  const visibleSet = useMemo(
    () => computeVisibleSet(deferredFilter, commits),
    [deferredFilter, commits]
  )

  const [scrollEl, setScrollEl] = useState<HTMLDivElement>()
  const {
    setScrollRef,
    onScroll,
    viewportHeight,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight
  } = useFixedVirtualizer({
    count: rows.length,
    rowHeight: ROW_H,
    overscan: OVERSCAN
  })
  const attachScroll = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return
      }
      setScrollEl(element)
      setScrollRef(element)
      const repoPath = props.repoPath
      if (repoPath) {
        element.scrollTop = historyScrollPositions.get(repoPath) ?? 0
      }
    },
    [props.repoPath, setScrollRef]
  )

  useEffect(() => {
    const repoPath = props.repoPath
    if (!scrollEl || !repoPath) {
      return
    }
    scrollEl.scrollTop = historyScrollPositions.get(repoPath) ?? 0
  }, [scrollEl, props.repoPath])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const repoPath = props.repoPath
    if (repoPath) {
      rememberHistoryScroll(repoPath, event.currentTarget.scrollTop)
    }
    onScroll(event)
  }

  const items = virtualItems
  const endIndexValue = endIndex
  const lastAutoLoadCount = useRef(0)
  const { hasMore, loading, loadingMore, onLoadMore } = props
  useEffect(() => {
    const total = rows.length
    const nearEnd = endIndexValue >= total - 3
    if (!nearEnd || !hasMore || loading || loadingMore || !onLoadMore || total === 0) {
      return
    }
    if (lastAutoLoadCount.current === total) {
      return
    }
    lastAutoLoadCount.current = total
    onLoadMore()
  }, [rows.length, endIndexValue, hasMore, loading, loadingMore, onLoadMore])

  const graphRailWidth = computeGraphRailWidth(layout ? layout.maxLanes : 1)

  const themeNonce = useThemeNonce()

  const gridTail = `${COL_AUTHOR_REM}rem ${COL_SHA_REM}rem ${COL_DATE_REM}rem`

  const hasCommits = allCommits.length > 0
  const showSkeleton = props.loading && !hasCommits

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FocusRail visibleRefs={visibleBranchRefs} onToggleRef={props.onToggleTimelineVisibility} />
      <HistoryHeader
        total={props.log?.total}
        visibleTotal={commits.length}
        loading={props.loading || graphLayout.layoutPending}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        filter={filter}
        onFilterChange={setFilter}
        showFilter={hasCommits}
        visibleBranchCount={visibleBranchCount}
      />

      {commits.length > 0 ? (
        <div className="flex h-[30px] shrink-0 items-center justify-end border-b bg-history-head px-0 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          <div className="grid items-center gap-2" style={{ gridTemplateColumns: gridTail }}>
            <span>Author</span>
            <span>SHA</span>
            <span className="pr-3 text-right">Date</span>
          </div>
        </div>
      ) : null}

      <div
        ref={attachScroll}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
        data-testid="history-scroll"
      >
        {props.log && commits.length > 0 ? (
          <div
            className="relative"
            style={{ height: `${totalHeight}px`, '--row-grid-tail': gridTail }}
          >
            <CommitGraphCanvas
              rows={rows}
              scrollContainer={scrollEl}
              viewportHeight={viewportHeight}
              visibleSet={visibleSet}
              railWidth={graphRailWidth}
              themeNonce={themeNonce}
              startIndex={startIndex}
              endIndex={endIndexValue}
              graphLayoutEndIndex={laidOutThroughIndex}
              allCommits={allCommits}
              displayedSet={displayedSet}
              expandedMerges={expandedMerges}
            />

            {items.map((virtualItem) => {
              const row = rows[virtualItem.index]
              if (!row) {
                return null
              }
              const glyph =
                row.commit.parents.length >= 2
                  ? mergeGlyphState(allCommits, row.commit, displayedSet, expandedMerges)
                  : 'none'
              return (
                <CommitRow
                  key={row.commit.hash}
                  row={row}
                  top={virtualItem.start}
                  dim={!!(visibleSet && !visibleSet.has(row.commit.hash))}
                  offBranch={!!onCurrentBranchSet && !onCurrentBranchSet.has(row.commit.hash)}
                  gridTail={gridTail}
                  remotes={remotes}
                  remoteNames={remoteNames}
                  mergeGlyph={glyph === 'none' ? undefined : glyph}
                  onToggleExpand={
                    glyph === 'none'
                      ? undefined
                      : () => props.onToggleMergeExpansion?.(row.commit.hash)
                  }
                  onCommitAction={props.onCommitAction}
                />
              )
            })}
          </div>
        ) : showSkeleton ? (
          <SkeletonRows
            graphRailWidth={graphRailWidth}
            gridTail={gridTail}
            viewportHeight={viewportHeight}
          />
        ) : hasCommits ? (
          <FilteredEmptyState />
        ) : (
          <HistoryEmptyState />
        )}
      </div>
    </div>
  )
}

function HistoryEmptyState() {
  return (
    <EmptyState
      size="sm"
      icon={GitCommitHorizontalIcon}
      title="No commits yet"
      description="Make your first commit to populate the timeline."
    />
  )
}

function FilteredEmptyState() {
  return (
    <EmptyState
      size="sm"
      icon={GitCommitHorizontalIcon}
      title="No matching commits"
      description="Visible branches have no commits in the loaded history yet."
    />
  )
}
