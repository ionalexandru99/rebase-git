import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommitAction } from '@/lib/git-actions'
import { computeGraphRailWidth, OVERSCAN, ROW_H } from '@/lib/git-graph/canvas'
import {
  getLayoutBoundary,
  getLayoutRow,
  type LayoutResult,
  type RowLayout
} from '@/lib/git-graph/layout'
import type { RefKind } from '@/lib/ref-tree'
import { HISTORY_LOAD_MORE_THRESHOLD_ROWS } from '@/lib/virtual-config'
import type { GitLog, GitLogEntry } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { useGraphLayout } from '../../hooks/useGraphLayout'
import { useThemeNonce } from '../../hooks/useThemeNonce'
import { useCoalescedCommitSnapshot } from '../../hooks/useTimelineVisibility'
import { EmptyState } from '../ui/empty-state'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import { FocusRail } from './FocusRail'
import { HistoryHeader } from './HistoryHeader'
import { SkeletonRows } from './SkeletonRows'
import {
  collectTimelineTips,
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  countVisibleBranchRefs,
  type MergeSideRange
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
  displayedCommitSet?: ReadonlySet<string>
  expandedMerges?: ReadonlySet<string>
  filter?: string
  onFilterChange?: (value: string) => void
  visibleSet?: Set<string> | null
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
const noop = () => {}

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
  const filter = props.filter ?? ''
  const visibleSet = props.visibleSet ?? null
  const remotes = props.remotes ?? EMPTY_REMOTES
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const allCommits = props.log?.all ?? EMPTY_COMMITS
  const graphCommits = useCoalescedCommitSnapshot(
    allCommits,
    props.loading || !!props.loadingMore,
    true
  )
  const visibleBranchRefs = props.visibleBranchRefs ?? EMPTY_REF_SET
  const expandedMerges = props.expandedMerges ?? EMPTY_REF_SET
  const remoteBranches = props.remoteBranches
  const commits = props.filteredCommits ?? EMPTY_COMMITS

  const displayedSet = useMemo(
    () => props.displayedCommitSet ?? new Set(commits.map((commit) => commit.hash)),
    [props.displayedCommitSet, commits]
  )
  const timelineTips = useMemo(
    () =>
      collectTimelineTips(
        graphCommits,
        visibleBranchRefs,
        remoteBranches ?? [],
        remoteNames,
        props.currentBranch
      ),
    [graphCommits, visibleBranchRefs, remoteBranches, remoteNames, props.currentBranch]
  )
  const mergeSideRanges = useMemo(
    () =>
      computeMergeSideRangeIndex(graphCommits, commits, displayedSet, expandedMerges, timelineTips),
    [graphCommits, commits, displayedSet, expandedMerges, timelineTips]
  )
  const loadedSet = useMemo(
    () => new Set(graphCommits.map((commit) => commit.hash)),
    [graphCommits]
  )
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
    () => computeOnBranchSet(graphCommits, remoteNames, currentBranch),
    [graphCommits, remoteNames, currentBranch]
  )

  const graphLayout = useGraphLayout({
    commits,
    loading: props.loading || !!props.loadingMore,
    enabled: commits.length > 0,
    isHiddenParent
  })
  const layout = graphLayout.layout
  const laidOutThroughIndex = graphLayout.laidOutThroughIndex

  const graphRailWidth = computeGraphRailWidth(layout ? layout.maxLanes : 1)

  const themeNonce = useThemeNonce()

  const gridTail = `${COL_AUTHOR_REM}rem ${COL_SHA_REM}rem ${COL_DATE_REM}rem`

  const hasCommits = allCommits.length > 0
  const showSkeleton = props.loading && !hasCommits

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FocusRail visibleRefs={visibleBranchRefs} onToggleRef={props.onToggleTimelineVisibility} />
      <HistoryHeader
        loadedCount={allCommits.length}
        visibleTotal={commits.length}
        loading={props.loading || graphLayout.layoutPending}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        filter={filter}
        onFilterChange={props.onFilterChange ?? noop}
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

      <HistoryViewport
        commits={commits}
        layout={layout}
        laidOutThroughIndex={laidOutThroughIndex}
        loadedCount={allCommits.length}
        hasLog={props.log !== null}
        loading={props.loading}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        repoPath={props.repoPath}
        visibleSet={visibleSet}
        graphRailWidth={graphRailWidth}
        themeNonce={themeNonce}
        mergeSideRanges={mergeSideRanges}
        onCurrentBranchSet={onCurrentBranchSet}
        gridTail={gridTail}
        remotes={remotes}
        remoteNames={remoteNames}
        onToggleMergeExpansion={props.onToggleMergeExpansion}
        onCommitAction={props.onCommitAction}
        showSkeleton={showSkeleton}
        hasCommits={hasCommits}
      />
    </div>
  )
}

interface HistoryViewportProps {
  commits: GitLogEntry[]
  layout: LayoutResult | null
  laidOutThroughIndex: number
  loadedCount: number
  hasLog: boolean
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  repoPath?: string | null
  visibleSet: Set<string> | null
  graphRailWidth: number
  themeNonce: number
  mergeSideRanges: ReadonlyMap<string, MergeSideRange>
  onCurrentBranchSet: Set<string> | null
  gridTail: string
  remotes: Record<string, string>
  remoteNames: Set<string>
  onToggleMergeExpansion?: (mergeHash: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  showSkeleton: boolean
  hasCommits: boolean
}

function HistoryViewport(props: HistoryViewportProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement>()
  const {
    setScrollRef,
    onScroll,
    viewportHeight,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight
  } = useFixedVirtualizer({
    count: props.commits.length,
    rowHeight: ROW_H,
    overscan: OVERSCAN
  })
  const attachScroll = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return
      }
      setScrollElement(element)
      setScrollRef(element)
      if (props.repoPath) {
        element.scrollTop = historyScrollPositions.get(props.repoPath) ?? 0
      }
    },
    [props.repoPath, setScrollRef]
  )

  useEffect(() => {
    if (!scrollElement || !props.repoPath) {
      return
    }
    const rememberedScrollTop = historyScrollPositions.get(props.repoPath) ?? 0
    if (
      rememberedScrollTop === 0 ||
      totalHeight - scrollElement.clientHeight >= rememberedScrollTop
    ) {
      scrollElement.scrollTop = rememberedScrollTop
    }
  }, [scrollElement, props.repoPath, totalHeight])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (props.repoPath && !props.loading) {
      rememberHistoryScroll(props.repoPath, event.currentTarget.scrollTop)
    }
    onScroll(event)
  }

  const lastAutoLoadKey = useRef<string | null>(null)
  useEffect(() => {
    const nearEnd = endIndex >= props.commits.length - HISTORY_LOAD_MORE_THRESHOLD_ROWS
    if (!nearEnd || !props.hasMore || props.loading || props.loadingMore || !props.onLoadMore) {
      return
    }
    const autoLoadKey = `${props.repoPath ?? ''}:${props.loadedCount}`
    if (lastAutoLoadKey.current === autoLoadKey) {
      return
    }
    lastAutoLoadKey.current = autoLoadKey
    props.onLoadMore()
  }, [
    endIndex,
    props.commits.length,
    props.hasMore,
    props.loadedCount,
    props.loading,
    props.loadingMore,
    props.onLoadMore,
    props.repoPath
  ])

  return (
    <div
      ref={attachScroll}
      onScroll={handleScroll}
      className="scroll-host min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      data-testid="history-scroll"
    >
      {props.hasLog && props.commits.length > 0 ? (
        <div
          className="relative"
          style={{ height: `${totalHeight}px`, '--row-grid-tail': props.gridTail }}
        >
          {props.layout ? (
            <CommitGraphCanvas
              layout={props.layout}
              scrollContainer={scrollElement}
              viewportHeight={viewportHeight}
              visibleSet={props.visibleSet}
              railWidth={props.graphRailWidth}
              themeNonce={props.themeNonce}
              startIndex={startIndex}
              endIndex={endIndex}
              graphLayoutEndIndex={props.laidOutThroughIndex}
              mergeSideRanges={props.mergeSideRanges}
            />
          ) : null}

          {virtualItems.map((virtualItem) => {
            const commit = props.commits[virtualItem.index]
            if (!commit) {
              return null
            }
            const laidOutRow =
              virtualItem.index < props.laidOutThroughIndex && props.layout
                ? getLayoutRow(props.layout, virtualItem.index)
                : undefined
            const hasMatchingLayout = laidOutRow?.commit.hash === commit.hash
            const row: RowLayout = hasMatchingLayout
              ? { commit, commitLane: laidOutRow.commitLane }
              : { commit, commitLane: 0 }
            const incoming =
              hasMatchingLayout && props.layout
                ? getLayoutBoundary(props.layout, virtualItem.index)
                : []
            const outgoing =
              hasMatchingLayout && props.layout
                ? getLayoutBoundary(props.layout, virtualItem.index + 1)
                : []
            const mergeSideRange = props.mergeSideRanges.get(commit.hash)
            return (
              <CommitRow
                key={commit.hash}
                row={row}
                incoming={incoming}
                outgoing={outgoing}
                top={virtualItem.start}
                dim={!!(props.visibleSet && !props.visibleSet.has(commit.hash))}
                offBranch={!!props.onCurrentBranchSet && !props.onCurrentBranchSet.has(commit.hash)}
                gridTail={props.gridTail}
                remotes={props.remotes}
                remoteNames={props.remoteNames}
                mergeGlyph={mergeSideRange?.glyph}
                onToggleExpand={mergeSideRange ? props.onToggleMergeExpansion : undefined}
                onCommitAction={props.onCommitAction}
              />
            )
          })}
        </div>
      ) : props.showSkeleton ? (
        <SkeletonRows
          graphRailWidth={props.graphRailWidth}
          gridTail={props.gridTail}
          viewportHeight={viewportHeight}
        />
      ) : props.hasCommits ? (
        <FilteredEmptyState />
      ) : (
        <HistoryEmptyState />
      )}
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
