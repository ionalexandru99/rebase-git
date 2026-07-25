import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { computeGraphRailWidth, laneColor } from '@/features/history/graph/canvas'
import type { GraphLayout } from '@/features/history/graph/layout'
import type { GraphMetrics } from '@/features/history/graph/metrics'
import type { GraphTopology } from '@/features/history/graph/topology'
import type { RefKind } from '@/features/refs/ref-tree'
import type { CommitAction } from '@/lib/git-actions'
import { HISTORY_LOAD_MORE_THRESHOLD_ROWS, HISTORY_OVERSCAN } from '@/lib/virtual-config'
import type { GitLog, GitLogEntry } from '@/types'
import { EmptyState } from '../../components/ui/empty-state'
import { useDraggablePane } from '../../hooks/useDraggablePane'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { useThemeNonce } from '../../hooks/useThemeNonce'
import { CommitDetailsPanel } from './CommitDetailsPanel'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import type { SelectionModifiers } from './commit-selection'
import { FocusRail } from './FocusRail'
import { HistoryHeader } from './HistoryHeader'
import { useCommitDetailsView } from './hooks/useCommitDetailsView'
import { useGraphLayout } from './hooks/useGraphLayout'
import { useGraphMetrics } from './hooks/useGraphMetrics'
import { SkeletonRows } from './SkeletonRows'
import {
  computeMergeSideRangeIndex,
  computeOnBranchSet,
  countVisibleBranchRefs,
  findRefTip,
  getCommitIndex,
  type MergeSideRange,
  parseFilterRefKey,
  refFilterKey
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
  // The whole loaded log, coalesced while streaming; `filteredCommits` is the subset on screen.
  graphCommits?: GitLogEntry[]
  filteredCommits?: GitLogEntry[]
  displayedCommitSet?: ReadonlySet<string>
  timelineTips?: readonly string[]
  expandedMerges?: ReadonlySet<string>
  filter?: string
  onFilterChange?: (value: string) => void
  visibleSet?: Set<string> | null
  onToggleMergeExpansion?: (mergeHash: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCommitAction?: (action: CommitAction, sha: string, message: string) => void
  repoPath?: string | null
}

const HISTORY_SCROLL_CACHE_LIMIT = 32
const historyScrollPositions = new Map<string, number>()

const DETAILS_HEIGHT_MIN = 180
const DETAILS_HEIGHT_MAX = 900
const DETAILS_HEIGHT_DEFAULT = 320
const DETAILS_HEIGHT_KEY = 'rebase:commit-details-height'

const loadDetailsHeight = async () => {
  const stored = Number(localStorage.getItem(DETAILS_HEIGHT_KEY))
  return {
    open: true,
    size: Number.isFinite(stored) && stored > 0 ? stored : DETAILS_HEIGHT_DEFAULT
  }
}

const saveDetailsHeight = (state: { size: number }) => {
  try {
    localStorage.setItem(DETAILS_HEIGHT_KEY, String(state.size))
  } catch {}
}

const EMPTY_COMMITS: GitLogEntry[] = []
const EMPTY_REMOTES: Record<string, string> = {}
const EMPTY_REF_SET: ReadonlySet<string> = new Set()
const EMPTY_TIPS: readonly string[] = []
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
  const metrics = useGraphMetrics()
  const filter = props.filter ?? ''
  const visibleSet = props.visibleSet ?? null
  const remotes = props.remotes ?? EMPTY_REMOTES
  const remoteNames = useMemo(() => new Set(Object.keys(remotes)), [remotes])

  const allCommits = props.log?.all ?? EMPTY_COMMITS
  const graphCommits = props.graphCommits ?? allCommits
  const visibleBranchRefs = props.visibleBranchRefs ?? EMPTY_REF_SET
  const expandedMerges = props.expandedMerges ?? EMPTY_REF_SET
  const remoteBranches = props.remoteBranches
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

  // A parent that is loaded but filtered out gets no lane; one that has not streamed in yet still
  // opens one. Reuses the commit index the panel already keeps rather than a second hash set.
  const loadedCommits = useMemo(() => getCommitIndex(graphCommits).byHash, [graphCommits])
  const isHiddenParent = useCallback(
    (hash: string) => loadedCommits.has(hash) && !displayedSet.has(hash),
    [loadedCommits, displayedSet]
  )
  const displayedPositions = useMemo(() => getCommitIndex(commits).positionByHash, [commits])
  const rowOf = useCallback((hash: string) => displayedPositions.get(hash), [displayedPositions])

  const visibleBranchCount = useMemo(
    () => countVisibleBranchRefs(visibleBranchRefs, remoteBranches, remoteNames),
    [visibleBranchRefs, remoteBranches, remoteNames]
  )

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

  const themeNonce = useThemeNonce()
  const gridTail = 'var(--history-grid-tail)'

  const colorByRefKey = useMemo(() => {
    const colors = new Map<string, string>()
    for (const key of visibleBranchRefs) {
      const ref = parseFilterRefKey(key)
      if (!ref) {
        continue
      }
      const tip = findRefTip(commits, ref.kind, ref.fullPath, remoteNames)
      const row = tip === undefined ? undefined : displayedPositions.get(tip)
      if (row === undefined || row >= graph.validRows) {
        continue
      }
      colors.set(refFilterKey(ref.kind, ref.fullPath), laneColor(graph.layout.commitLane[row]))
    }
    return colors
  }, [commits, displayedPositions, graph.layout, graph.validRows, remoteNames, visibleBranchRefs])

  const hasCommits = allCommits.length > 0
  const showSkeleton = props.loading && !hasCommits

  const orderedShas = useMemo(() => commits.map((commit) => commit.hash), [commits])
  const details = useCommitDetailsView(props.repoPath, orderedShas)

  const { size: detailsHeight, onResizeStart: onDetailsResizeStart } = useDraggablePane({
    min: DETAILS_HEIGHT_MIN,
    max: DETAILS_HEIGHT_MAX,
    defaultSize: DETAILS_HEIGHT_DEFAULT,
    axis: 'vertical',
    handle: 'start',
    load: loadDetailsHeight,
    save: saveDetailsHeight
  })

  const selectionShas = details.selection.shas
  const selectedLaneHex = useMemo(() => {
    const only = selectionShas.length === 1 ? selectionShas[0] : undefined
    const row = only === undefined ? undefined : displayedPositions.get(only)
    return row === undefined || row >= graph.validRows
      ? laneColor(0)
      : laneColor(graph.layout.commitLane[row])
  }, [selectionShas, displayedPositions, graph.layout, graph.validRows])

  return (
    <div className="flex h-full min-h-0 flex-col" data-history-panel="">
      <FocusRail
        visibleRefs={visibleBranchRefs}
        colorByRefKey={colorByRefKey}
        onToggleRef={props.onToggleTimelineVisibility}
      />
      <HistoryHeader
        loadedCount={allCommits.length}
        visibleTotal={commits.length}
        loading={props.loading || graph.pending}
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
            <span data-history-column="sha">SHA</span>
            <span data-history-column="date" className="pr-3 text-right">
              Date
            </span>
          </div>
        </div>
      ) : null}

      <HistoryViewport
        commits={commits}
        layout={graph.layout}
        topology={graph.topology}
        validRows={graph.validRows}
        metrics={metrics}
        loadedCount={allCommits.length}
        hasLog={props.log !== null}
        loading={props.loading}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        repoPath={props.repoPath}
        visibleSet={visibleSet}
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
        selectedShas={details.selectedShas}
        onSelectCommit={details.selectCommit}
        onOpenCommitDetails={details.openDetails}
      />

      {details.detailsOpen ? (
        <CommitDetailsPanel
          selection={details.selection}
          commitsByHash={loadedCommits}
          remotes={remotes}
          remoteNames={remoteNames}
          laneHex={selectedLaneHex}
          height={detailsHeight}
          onResizeStart={onDetailsResizeStart}
          onClose={details.closeDetails}
          onCommitAction={props.onCommitAction}
        />
      ) : null}
    </div>
  )
}

interface HistoryViewportProps {
  commits: GitLogEntry[]
  layout: GraphLayout
  topology: GraphTopology
  validRows: number
  metrics: GraphMetrics
  loadedCount: number
  hasLog: boolean
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  repoPath?: string | null
  visibleSet: Set<string> | null
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
  selectedShas: ReadonlySet<string>
  onSelectCommit: (sha: string, modifiers: SelectionModifiers) => void
  onOpenCommitDetails: (sha: string) => void
}

function HistoryViewport(props: HistoryViewportProps) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement>()
  const { setScrollRef, onScroll, viewportHeight, virtualItems, endIndex, totalHeight } =
    useFixedVirtualizer({
      count: props.commits.length,
      rowHeight: props.metrics.rowHeight,
      overscan: HISTORY_OVERSCAN
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
          <CommitGraphCanvas
            layout={props.layout}
            topology={props.topology}
            commits={props.commits}
            metrics={props.metrics}
            scrollContainer={scrollElement}
            viewportHeight={viewportHeight}
            visibleSet={props.visibleSet}
            themeNonce={props.themeNonce}
            rowCount={props.validRows}
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
                railLanes={laidOut ? props.layout.railLanes[virtualItem.index] : 1}
                metrics={props.metrics}
                top={virtualItem.start}
                dim={!!(props.visibleSet && !props.visibleSet.has(commit.hash))}
                offBranch={!!props.onCurrentBranchSet && !props.onCurrentBranchSet.has(commit.hash)}
                gridTail={props.gridTail}
                remotes={props.remotes}
                remoteNames={props.remoteNames}
                mergeGlyph={props.mergeSideRanges.get(commit.hash)?.glyph}
                selected={props.selectedShas.has(commit.hash)}
                onToggleExpand={props.onToggleMergeExpansion}
                onSelect={props.onSelectCommit}
                onOpenDetails={props.onOpenCommitDetails}
                onCommitAction={props.onCommitAction}
              />
            )
          })}
        </div>
      ) : props.showSkeleton ? (
        <SkeletonRows
          graphRailWidth={computeGraphRailWidth(1, props.metrics)}
          gridTail={props.gridTail}
          rowHeight={props.metrics.rowHeight}
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
