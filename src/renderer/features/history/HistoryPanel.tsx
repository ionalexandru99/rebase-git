import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphLayout } from '@/features/history/graph/layout'
import { type GraphMetrics, graphMetricsWithRowHeight } from '@/features/history/graph/metrics'
import type { GraphTopology } from '@/features/history/graph/topology'
import type { CommitAction } from '@/lib/git-actions'
import { HISTORY_LOAD_MORE_THRESHOLD_ROWS, HISTORY_OVERSCAN } from '@/lib/virtual-config'
import type { GitLog, GitLogEntry } from '@/types'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import type { SelectionModifiers } from './commit-selection'
import { useCommitStats } from './hooks/useCommitStats'
import { useGraphLayout } from './hooks/useGraphLayout'
import { useGraphMetrics } from './hooks/useGraphMetrics'
import { useWorkingCopy } from './hooks/useWorkingCopy'
import {
  type HistoryListMode,
  listModeForWidth,
  rowHeightForMode,
  WORKING_COPY_ROW_HEIGHT
} from './list-modes'
import { historyRailWidth, reanchorScrollTop } from './row-layout'
import { SkeletonRows } from './SkeletonRows'
import {
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  getCommitIndex,
  getRefTipIndex,
  type MergeSideRange
} from './selectors'
import { WorkingCopyRow } from './WorkingCopyRow'

interface HistoryPanelProps {
  log: GitLog | null
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  remotes?: Record<string, string>
  currentBranch?: string
  graphCommits?: GitLogEntry[]
  filteredCommits?: GitLogEntry[]
  displayedCommitSet?: ReadonlySet<string>
  timelineTips?: readonly string[]
  expandedMerges?: ReadonlySet<string>
  visibleSet?: Set<string> | null
  onToggleMergeExpansion?: (mergeHash: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  selectedShas?: ReadonlySet<string>
  onSelectCommit?: (sha: string, modifiers: SelectionModifiers) => void
  onSelectWorkingCopy?: () => void
  workingCopySelected?: boolean
  repoPath?: string | null
}

const HISTORY_SCROLL_CACHE_LIMIT = 32
const historyScrollPositions = new Map<string, number>()

const EMPTY_COMMITS: GitLogEntry[] = []
const EMPTY_REMOTES: Record<string, string> = {}
const EMPTY_REF_SET: ReadonlySet<string> = new Set()
const EMPTY_SHAS: ReadonlySet<string> = new Set()
const EMPTY_TIPS: readonly string[] = []

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
  const metrics = useGraphMetrics()
  const visibleSet = props.visibleSet ?? null
  const remotes = props.remotes ?? EMPTY_REMOTES
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const allCommits = props.log?.all ?? EMPTY_COMMITS
  const graphCommits = props.graphCommits ?? allCommits
  const expandedMerges = props.expandedMerges ?? EMPTY_REF_SET
  const commits = props.filteredCommits ?? EMPTY_COMMITS
  const timelineTips = props.timelineTips ?? EMPTY_TIPS

  const displayedSet = useMemo(
    () => props.displayedCommitSet ?? new Set(commits.map((commit) => commit.hash)),
    [props.displayedCommitSet, commits]
  )
  const mergeSideRanges = useMemo(
    () =>
      computeMergeSideRangeIndex(graphCommits, commits, displayedSet, expandedMerges, timelineTips),
    [graphCommits, commits, displayedSet, expandedMerges, timelineTips]
  )

  const loadedCommits = useMemo(() => getCommitIndex(graphCommits).byHash, [graphCommits])
  const isHiddenParent = useCallback(
    (hash: string) => loadedCommits.has(hash) && !displayedSet.has(hash),
    [loadedCommits, displayedSet]
  )
  const displayedPositions = useMemo(() => getCommitIndex(commits).positionByHash, [commits])
  const rowOf = useCallback((hash: string) => displayedPositions.get(hash), [displayedPositions])

  const currentBranch = props.currentBranch
  const onCurrentBranchSet = useMemo(
    () => computeOnBranchSet(graphCommits, remoteNames, currentBranch),
    [graphCommits, remoteNames, currentBranch]
  )

  const graph = useGraphLayout({
    commits,
    enabled: commits.length > 0,
    rowOf,
    isHiddenParent
  })

  const headRow = useMemo(() => {
    const headTip = getRefTipIndex(commits, remoteNames).headTip
    const row = headTip === undefined ? undefined : displayedPositions.get(headTip)
    return row === undefined ? 0 : row
  }, [commits, displayedPositions, remoteNames])

  const hasCommits = allCommits.length > 0
  const showSkeleton = props.loading && !hasCommits

  const orderedShas = useMemo(() => commits.map((commit) => commit.hash), [commits])

  return (
    <div className="flex h-full min-h-0 flex-col" data-history-panel="">
      <HistoryViewport
        commits={commits}
        layout={graph.layout}
        topology={graph.topology}
        validRows={graph.validRows}
        metrics={metrics}
        orderedShas={orderedShas}
        headRow={headRow}
        loadedCount={allCommits.length}
        hasLog={props.log !== null}
        loading={props.loading}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        repoPath={props.repoPath}
        visibleSet={visibleSet}
        mergeSideRanges={mergeSideRanges}
        onCurrentBranchSet={onCurrentBranchSet}
        remotes={remotes}
        remoteNames={remoteNames}
        onToggleMergeExpansion={props.onToggleMergeExpansion}
        onCommitAction={props.onCommitAction}
        onSelectWorkingCopy={props.onSelectWorkingCopy}
        workingCopySelected={props.workingCopySelected}
        showSkeleton={showSkeleton}
        hasCommits={hasCommits}
        selectedShas={props.selectedShas ?? EMPTY_SHAS}
        onSelectCommit={props.onSelectCommit}
      />
    </div>
  )
}

interface HistoryViewportProps {
  commits: GitLogEntry[]
  layout: GraphLayout
  topology: GraphTopology
  validRows: number
  metrics: GraphMetrics
  orderedShas: readonly string[]
  headRow: number
  loadedCount: number
  hasLog: boolean
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  repoPath?: string | null
  visibleSet: Set<string> | null
  mergeSideRanges: ReadonlyMap<string, MergeSideRange>
  onCurrentBranchSet: Set<string> | null
  remotes: Record<string, string>
  remoteNames: Set<string>
  onToggleMergeExpansion?: (mergeHash: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  onSelectWorkingCopy?: () => void
  workingCopySelected?: boolean
  showSkeleton: boolean
  hasCommits: boolean
  selectedShas: ReadonlySet<string>
  onSelectCommit?: (sha: string, modifiers: SelectionModifiers) => void
}

function HistoryViewport(props: HistoryViewportProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement>()
  const [mode, setMode] = useState<HistoryListMode>('narrow')
  const metrics = useMemo(
    () => graphMetricsWithRowHeight(props.metrics, rowHeightForMode(mode)),
    [props.metrics, mode]
  )
  const {
    setScrollRef,
    onScroll,
    viewportHeight,
    viewportWidth,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight
  } = useFixedVirtualizer({
    count: props.commits.length,
    rowHeight: metrics.rowHeight,
    overscan: HISTORY_OVERSCAN,
    paddingStart: WORKING_COPY_ROW_HEIGHT
  })
  const measuredMode = listModeForWidth(viewportWidth)
  if (measuredMode !== mode) {
    setMode(measuredMode)
  }
  const railWidth = historyRailWidth(props.layout.maxLanes, metrics)
  const commitStats = useCommitStats(props.repoPath, props.orderedShas, startIndex, endIndex)
  const workingCopy = useWorkingCopy(props.repoPath)
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

  const anchoredRowHeight = useRef(metrics.rowHeight)
  useLayoutEffect(() => {
    if (!scrollElement || anchoredRowHeight.current === metrics.rowHeight) {
      anchoredRowHeight.current = metrics.rowHeight
      return
    }
    const anchored = reanchorScrollTop({
      scrollTop: scrollElement.scrollTop,
      previousRowHeight: anchoredRowHeight.current,
      nextRowHeight: metrics.rowHeight,
      paddingStart: WORKING_COPY_ROW_HEIGHT
    })
    anchoredRowHeight.current = metrics.rowHeight
    scrollElement.scrollTop = anchored
    if (props.repoPath) {
      rememberHistoryScroll(props.repoPath, anchored)
    }
  }, [scrollElement, metrics.rowHeight, props.repoPath])

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
        <div className="relative" style={{ height: `${totalHeight}px` }}>
          <WorkingCopyRow
            mode={mode}
            railWidth={railWidth}
            counts={workingCopy.counts}
            stats={workingCopy.stats}
            selected={props.workingCopySelected === true}
            onSelect={props.onSelectWorkingCopy}
          />

          <CommitGraphCanvas
            layout={props.layout}
            topology={props.topology}
            commits={props.commits}
            metrics={metrics}
            scrollContainer={scrollElement}
            viewportHeight={viewportHeight}
            visibleSet={props.visibleSet}
            rowCount={props.validRows}
            paddingStart={WORKING_COPY_ROW_HEIGHT}
            headRow={props.headRow}
            mergeSideRanges={props.mergeSideRanges}
          />

          {virtualItems.map((virtualItem) => {
            const commit = props.commits[virtualItem.index]
            if (!commit) {
              return null
            }
            const laidOut = virtualItem.index < props.validRows
            return (
              <CommitRow
                key={commit.hash}
                commit={commit}
                lane={laidOut ? props.layout.commitLane[virtualItem.index] : 0}
                metrics={metrics}
                mode={mode}
                railWidth={railWidth}
                stats={commitStats.get(commit.hash)}
                top={virtualItem.start}
                dim={!!(props.visibleSet && !props.visibleSet.has(commit.hash))}
                offBranch={!!props.onCurrentBranchSet && !props.onCurrentBranchSet.has(commit.hash)}
                remotes={props.remotes}
                remoteNames={props.remoteNames}
                mergeGlyph={props.mergeSideRanges.get(commit.hash)?.glyph}
                selected={props.selectedShas.has(commit.hash)}
                onToggleExpand={props.onToggleMergeExpansion}
                onSelect={props.onSelectCommit}
                onCommitAction={props.onCommitAction}
              />
            )
          })}
        </div>
      ) : (
        <>
          <div className="relative" style={{ height: `${WORKING_COPY_ROW_HEIGHT}px` }}>
            <WorkingCopyRow
              mode={mode}
              railWidth={railWidth}
              counts={workingCopy.counts}
              stats={workingCopy.stats}
              selected={props.workingCopySelected === true}
              onSelect={props.onSelectWorkingCopy}
            />
          </div>
          {props.showSkeleton ? (
            <SkeletonRows
              graphRailWidth={railWidth}
              mode={mode}
              rowHeight={metrics.rowHeight}
              viewportHeight={viewportHeight}
            />
          ) : props.hasCommits ? (
            <FilteredEmptyState />
          ) : (
            <HistoryEmptyState />
          )}
        </>
      )}

      {props.hasMore && props.onLoadMore ? (
        <div className="flex shrink-0 items-center justify-center px-2 py-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={props.loadingMore || props.loading}
            onClick={() => props.onLoadMore?.()}
          >
            {props.loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
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
