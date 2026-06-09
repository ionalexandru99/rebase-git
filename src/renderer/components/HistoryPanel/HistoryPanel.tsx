import { GitCommitHorizontalIcon } from 'lucide-react'
import type { UIEvent } from 'react'
import { useCallback } from 'react'
import { computeGraphRailWidth, OVERSCAN, ROW_H } from '@/lib/git-graph/canvas'
import {
  createDeferred,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show
} from '@/lib/react-compat'
import type { RefKind } from '@/lib/ref-tree'
import type { GitLog, GitLogEntry } from '@/types'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { buildDisplayRows, useGraphLayoutWorker } from '../../hooks/useGraphLayoutWorker'
import { useThemeNonce } from '../../hooks/useThemeNonce'
import { EmptyState } from '../ui/empty-state'
import { CommitGraphCanvas } from './CommitGraphCanvas'
import { CommitRow } from './CommitRow'
import { FocusRail } from './FocusRail'
import { HistoryHeader } from './HistoryHeader'
import { SkeletonRows } from './SkeletonRows'
import {
  computeBranchFilterSet,
  computeOnBranchSet,
  computeVisibleSet,
  countVisibleBranchRefs
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
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  repoPath?: string | null
}

const COL_AUTHOR_REM = 12
const COL_SHA_REM = 4.5
const COL_DATE_REM = 7.5
const HISTORY_SCROLL_CACHE_LIMIT = 32
const historyScrollPositions = new Map<string, number>()

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
  const [filter, setFilter] = createSignal('')
  const deferredFilter = createDeferred(filter)
  const remotes = () => props.remotes ?? {}
  const remoteNames = createMemo(() => new Set(Object.keys(remotes())))

  const allCommits = createMemo<GitLogEntry[]>(() => props.log?.all ?? [])

  const visibleBranchRefs = () => props.visibleBranchRefs ?? new Set<string>()

  const hasVisibleBranches = () => visibleBranchRefs().size > 0

  const visibleBranchCount = () =>
    countVisibleBranchRefs(visibleBranchRefs(), props.remoteBranches, remoteNames())

  const branchFilteredSet = createMemo(() => {
    if (!hasVisibleBranches()) {
      return new Set<string>()
    }
    return (
      computeBranchFilterSet(
        allCommits(),
        visibleBranchRefs(),
        props.remoteBranches,
        remoteNames()
      ) ?? new Set()
    )
  })

  const onCurrentBranchSet = createMemo(() =>
    computeOnBranchSet(allCommits(), remoteNames(), props.currentBranch)
  )

  const commits = createMemo<GitLogEntry[]>(() => {
    if (!hasVisibleBranches()) {
      return []
    }
    return allCommits().filter((commit) => branchFilteredSet().has(commit.hash))
  })

  const graphLayout = useGraphLayoutWorker({
    commits,
    loading: () => props.loading || !!props.loadingMore,
    enabled: () => commits().length > 0
  })

  const rows = createMemo(() =>
    buildDisplayRows(commits(), graphLayout.layout(), graphLayout.laidOutThroughIndex())
  )

  const visibleSet = createMemo(() => computeVisibleSet(deferredFilter(), commits()))

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const {
    setScrollRef,
    onScroll,
    viewportHeight,
    virtualItems,
    startIndex,
    endIndex,
    totalHeight,
    scrollTop
  } = useFixedVirtualizer({
    count: () => rows().length,
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
    [props.repoPath, setScrollEl, setScrollRef]
  )

  createEffect(() => {
    const element = scrollEl()
    const repoPath = props.repoPath
    if (!element || !repoPath) {
      return
    }
    element.scrollTop = historyScrollPositions.get(repoPath) ?? 0
  })

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const repoPath = props.repoPath
    if (repoPath) {
      rememberHistoryScroll(repoPath, event.currentTarget.scrollTop)
    }
    onScroll(event)
  }

  let lastAutoLoadCount = 0
  createEffect(() => {
    const total = rows().length
    const nearEnd = endIndex() >= total - 3
    if (
      !nearEnd ||
      !props.hasMore ||
      props.loading ||
      props.loadingMore ||
      !props.onLoadMore ||
      total === 0
    ) {
      return
    }
    if (lastAutoLoadCount === total) {
      return
    }
    lastAutoLoadCount = total
    props.onLoadMore()
  })

  const graphRailWidth = createMemo(() => {
    const layout = graphLayout.layout()
    if (!layout) {
      return computeGraphRailWidth(1)
    }
    return computeGraphRailWidth(layout.maxLanes)
  })

  const themeNonce = useThemeNonce()

  const gridTail = `${COL_AUTHOR_REM}rem ${COL_SHA_REM}rem ${COL_DATE_REM}rem`
  const headerGridTemplate = () => `${graphRailWidth()}px minmax(0,1fr) ${gridTail}`

  const hasCommits = () => allCommits().length > 0
  const showSkeleton = () => props.loading && !hasCommits()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FocusRail visibleRefs={visibleBranchRefs()} onToggleRef={props.onToggleTimelineVisibility} />
      <HistoryHeader
        total={props.log?.total}
        visibleTotal={commits().length}
        loading={props.loading || graphLayout.layoutPending()}
        loadingMore={props.loadingMore}
        hasMore={props.hasMore}
        onLoadMore={props.onLoadMore}
        filter={filter()}
        onFilterChange={setFilter}
        showFilter={allCommits().length > 0}
        visibleBranchCount={visibleBranchCount()}
      />

      <Show when={commits().length > 0}>
        <div
          className="grid h-[30px] shrink-0 items-center gap-1 border-b bg-history-head px-0 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"
          style={{ gridTemplateColumns: headerGridTemplate() }}
        >
          <span aria-hidden="true" />
          <span>Subject</span>
          <span>Author</span>
          <span>SHA</span>
          <span className="pr-3 text-right">Date</span>
        </div>
      </Show>

      <div
        ref={attachScroll}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto"
        data-testid="history-scroll"
      >
        <Show
          when={props.log && commits().length > 0}
          fallback={
            <Show
              when={showSkeleton()}
              fallback={
                <Show when={allCommits().length > 0} fallback={<HistoryEmptyState />}>
                  <FilteredEmptyState />
                </Show>
              }
            >
              <SkeletonRows
                graphRailWidth={graphRailWidth()}
                gridTail={gridTail}
                viewportHeight={viewportHeight()}
              />
            </Show>
          }
        >
          <div
            className="relative"
            style={{ height: `${totalHeight()}px`, '--row-grid-tail': gridTail }}
          >
            <CommitGraphCanvas
              rows={rows()}
              scrollContainer={scrollEl}
              viewportHeight={viewportHeight()}
              visibleSet={visibleSet()}
              railWidth={graphRailWidth()}
              themeNonce={themeNonce()}
              scrollTop={scrollTop()}
              startIndex={startIndex()}
              endIndex={endIndex()}
              graphLayoutEndIndex={graphLayout.laidOutThroughIndex()}
            />

            <For each={virtualItems()}>
              {(virtualItem) => {
                const row = () => rows()[virtualItem.index]
                return (
                  <Show when={row()}>
                    {(layoutRow) => (
                      <CommitRow
                        row={layoutRow()}
                        top={virtualItem.start}
                        dim={!!(visibleSet() && !visibleSet()?.has(layoutRow().commit.hash))}
                        offBranch={
                          !!onCurrentBranchSet() &&
                          !onCurrentBranchSet()?.has(layoutRow().commit.hash)
                        }
                        gridTail={gridTail}
                        remotes={remotes()}
                        remoteNames={remoteNames()}
                      />
                    )}
                  </Show>
                )
              }}
            </For>
          </div>
        </Show>
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
