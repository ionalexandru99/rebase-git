import type { RepoRef } from '@common/features/repository-identity'
import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphLayout } from '@/features/history/graph/layout'
import { type GraphMetrics, graphMetricsWithRowHeight } from '@/features/history/graph/metrics'
import type { GraphTopology } from '@/features/history/graph/topology'
import type { CommitAction } from '@/lib/git-actions'
import { HISTORY_OVERSCAN } from '@/lib/virtual-config'
import type { GitLogEntry } from '@/types'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import type { SelectionModifiers } from './commit-selection'
import {
  canRestoreHistoryScroll,
  historyScrollMemory,
  nextHistoryAutoLoadKey
} from './history-viewport-state'
import { useCommitStats } from './hooks/useCommitStats'
import { useWorkingCopy } from './hooks/useWorkingCopy'
import {
  type HistoryListMode,
  listModeForWidth,
  rowHeightForMode,
  WORKING_COPY_ROW_HEIGHT
} from './list-modes'
import { historyRailWidth, reanchorScrollTop } from './row-layout'
import { SkeletonRows } from './SkeletonRows'
import type { MergeSideRange } from './selectors'
import { WorkingCopyRow } from './WorkingCopyRow'

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
  repository?: RepoRef | null
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

export function HistoryViewport(props: HistoryViewportProps) {
  const repository = props.repository ?? props.repoPath
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
  const commitStats = useCommitStats(repository, props.orderedShas, startIndex, endIndex)
  const workingCopy = useWorkingCopy(repository)
  const attachScroll = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        return
      }
      setScrollElement(element)
      setScrollRef(element)
      if (repository) {
        element.scrollTop = historyScrollMemory.get(repository)
      }
    },
    [repository, setScrollRef]
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
    if (repository) {
      historyScrollMemory.remember(repository, anchored)
    }
  }, [scrollElement, metrics.rowHeight, repository])

  useEffect(() => {
    if (!scrollElement || !repository) {
      return
    }
    const rememberedScrollTop = historyScrollMemory.get(repository)
    if (canRestoreHistoryScroll(rememberedScrollTop, totalHeight, scrollElement.clientHeight)) {
      scrollElement.scrollTop = rememberedScrollTop
    }
  }, [scrollElement, repository, totalHeight])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (repository && !props.loading) {
      historyScrollMemory.remember(repository, event.currentTarget.scrollTop)
    }
    onScroll(event)
  }

  const lastAutoLoadKey = useRef<string | null>(null)
  useEffect(() => {
    const autoLoadKey = nextHistoryAutoLoadKey(
      {
        endIndex,
        commitCount: props.commits.length,
        hasMore: props.hasMore,
        loading: props.loading,
        loadingMore: props.loadingMore,
        canLoadMore: props.onLoadMore !== undefined,
        repository,
        loadedCount: props.loadedCount
      },
      lastAutoLoadKey.current
    )
    if (autoLoadKey === null) {
      return
    }
    lastAutoLoadKey.current = autoLoadKey
    props.onLoadMore?.()
  }, [
    endIndex,
    props.commits.length,
    props.hasMore,
    props.loadedCount,
    props.loading,
    props.loadingMore,
    props.onLoadMore,
    repository
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
