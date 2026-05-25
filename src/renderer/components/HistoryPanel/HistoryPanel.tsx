import { GitCommitHorizontalIcon } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  computeRowRailWidth,
  COL_W as GRAPH_COL_W,
  OVERSCAN,
  RAIL_PAD,
  ROW_H
} from '@/lib/git-graph/canvas'
import { type LayoutResult, layoutCommits } from '@/lib/git-graph/layout'
import type { GitLog, GitLogEntry } from '@/types'
import { useThemeNonce } from '../../hooks/useThemeNonce'
import { useVirtualList } from '../../hooks/useVirtualList'
import { EmptyState } from '../ui/empty-state'
import { Panel } from '../ui/panel'
import { CommitGraphCanvas } from './CommitGraphCanvas'
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

export function HistoryPanel(props: HistoryPanelProps) {
  const [filter, setFilter] = createSignal('')
  const remotes = () => props.remotes ?? {}
  const remoteNames = createMemo(() => new Set(Object.keys(remotes())))

  const commits = createMemo<GitLogEntry[]>(() => props.log?.all ?? [])

  const onBranchSet = createMemo(() =>
    computeOnBranchSet(commits(), remoteNames(), props.currentBranch)
  )

  let layoutCache: LayoutResult | null = null
  const layout = createMemo(() => {
    const result = layoutCommits(commits(), layoutCache ?? undefined)
    layoutCache = result
    return result
  })
  const rows = () => layout().rows

  const visibleSet = createMemo(() => computeVisibleSet(filter(), commits()))

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const { setScrollRef, onScroll, viewportHeight, startIndex, endIndex, totalHeight, scrollTop } =
    useVirtualList({
      rowCount: () => rows().length,
      rowHeight: ROW_H,
      overscan: OVERSCAN
    })
  const attachScroll = (element: HTMLDivElement) => {
    setScrollEl(element)
    setScrollRef(element)
  }

  const localMaxLanes = createMemo(() => {
    let max = 0
    const currentRows = rows()
    for (let i = startIndex(); i < endIndex(); i++) {
      const row = currentRows[i]
      if (!row) continue
      const candidate = Math.max(row.incoming.length, row.outgoing.length, row.commitLane + 1)
      if (candidate > max) max = candidate
    }
    return max
  })
  const railWidth = () =>
    Math.max(28, RAIL_PAD * 2 + Math.max(localMaxLanes() - 1, 0) * GRAPH_COL_W)

  const themeNonce = useThemeNonce()

  const gridTemplate = `minmax(0,1fr) ${COL_AUTHOR_REM}rem ${COL_SHA_REM}rem ${COL_DATE_REM}rem`

  const visibleRows = createMemo(() => rows().slice(startIndex(), endIndex()))

  return (
    <Panel class="h-full">
      <HistoryHeader
        total={props.log?.total}
        loading={props.loading}
        filter={filter()}
        onFilterChange={setFilter}
        showFilter={commits().length > 0}
      />

      <Show when={commits().length > 0}>
        <div
          class="grid h-7 shrink-0 items-center gap-1 border-b bg-muted/30 px-0 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ 'grid-template-columns': gridTemplate }}
        >
          <span class="pl-3">Subject</span>
          <span>Author</span>
          <span>SHA</span>
          <span class="pr-3 text-right">Date</span>
        </div>
      </Show>

      <div
        ref={attachScroll}
        onScroll={onScroll}
        class="min-h-0 flex-1 overflow-auto"
        data-testid="history-scroll"
      >
        <Show
          when={props.log && commits().length > 0}
          fallback={
            <Show when={props.loading} fallback={<HistoryEmptyState />}>
              <SkeletonRows gridTemplate={gridTemplate} viewportHeight={viewportHeight()} />
            </Show>
          }
        >
          <div
            class="relative"
            style={{ height: `${totalHeight()}px`, '--row-cols': gridTemplate }}
          >
            <Show when={props.loading}>
              <LoadingOverlay
                totalHeight={totalHeight()}
                scrollTop={scrollTop()}
                viewportHeight={viewportHeight()}
                gridTemplate={gridTemplate}
              />
            </Show>

            <CommitGraphCanvas
              rows={rows()}
              scrollContainer={scrollEl}
              viewportHeight={viewportHeight()}
              visibleSet={visibleSet()}
              railWidth={railWidth()}
              themeNonce={themeNonce()}
              scrollTop={scrollTop()}
            />

            <For each={visibleRows()}>
              {(row, idx) => (
                <CommitRow
                  row={row}
                  index={startIndex() + idx()}
                  dim={!!(visibleSet() && !visibleSet()?.has(row.commit.hash))}
                  offBranch={!!(onBranchSet() && !onBranchSet()?.has(row.commit.hash))}
                  rowRailWidth={computeRowRailWidth(row)}
                  remotes={remotes()}
                  remoteNames={remoteNames()}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </Panel>
  )
}

interface LoadingOverlayProps {
  totalHeight: number
  scrollTop: number
  viewportHeight: number
  gridTemplate: string
}

function LoadingOverlay(props: LoadingOverlayProps) {
  const visibleBelow = () => Math.max(0, props.totalHeight - props.scrollTop)
  const overlayHeight = () => Math.min(props.viewportHeight, visibleBelow())
  return (
    <Show when={overlayHeight() > 0}>
      <div
        class="pointer-events-none sticky top-0 z-0"
        style={{ height: '0px' }}
        aria-hidden="true"
      >
        <div
          class="absolute inset-x-0 top-0 overflow-hidden"
          style={{ height: `${overlayHeight()}px` }}
        >
          <SkeletonRows gridTemplate={props.gridTemplate} viewportHeight={overlayHeight()} />
        </div>
      </div>
    </Show>
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
