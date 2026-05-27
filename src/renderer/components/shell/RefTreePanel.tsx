import { parseOrThrow } from '@shared/codec'
import { filterPersistedRefTreeToggles } from '@shared/ref-tree-toggles'
import { RefTreeTogglesSchema } from '@shared/schemas/ipc'
import { type Accessor, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  type RefRow
} from '@/lib/ref-tree'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { RefTreeRow } from './RefTreeRow'

export type { RefKind } from '@/lib/ref-tree'

interface RefTreePanelProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  currentBranch: string
  loading?: boolean
  tracking?: Record<string, BranchTracking>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

interface VirtualRefTreeRowProps {
  index: number
  top: number
  rows: Accessor<RefRow[]>
  localLoading: boolean
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

function VirtualRefTreeRow(props: VirtualRefTreeRowProps) {
  const row = createMemo(() => props.rows()[props.index])
  return (
    <Show when={row()}>
      {(definedRow) => (
        <RefTreeRow
          row={definedRow()}
          top={props.top}
          localLoading={props.localLoading}
          visibleTimelineRefs={props.visibleTimelineRefs}
          onToggleCollapsed={props.onToggleCollapsed}
          onToggleTimelineVisibility={props.onToggleTimelineVisibility}
          onCheckoutLeaf={props.onCheckoutRef}
        />
      )}
    </Show>
  )
}

function persistToggles(next: Set<string>): void {
  window.electronAPI.setRefTreeToggles(filterPersistedRefTreeToggles([...next]))
}

export function RefTreePanel(props: RefTreePanelProps) {
  const [toggles, setToggles] = createSignal<Set<string>>(new Set())

  onMount(() => {
    let cancelled = false
    window.electronAPI
      .getRefTreeToggles()
      .then((res) => {
        if (cancelled) {
          return
        }
        const decoded = parseOrThrow(RefTreeTogglesSchema, res)
        setToggles(new Set(filterPersistedRefTreeToggles(decoded)))
      })
      .catch((err: unknown) => {
        console.warn('[RefTreePanel] failed to load toggles', err)
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  const rows = createMemo(() =>
    buildRefTreeRows({
      localBranches: props.localBranches,
      remoteBranches: props.remoteBranches,
      tags: props.tags,
      toggles: toggles(),
      currentBranch: props.currentBranch,
      localLoading: props.loading ?? false,
      tracking: props.tracking
    })
  )

  const { setScrollRef, onScroll, virtualItems, totalHeight, virtualizer } = useFixedVirtualizer({
    count: () => rows().length,
    rowHeight: REF_TREE_ROW_HEIGHT,
    overscan: REF_TREE_OVERSCAN,
    initialViewportHeight: 400
  })

  const toggle = (key: string) => {
    setToggles((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      persistToggles(next)
      queueMicrotask(() => {
        virtualizer.measure()
      })
      return next
    })
  }

  return (
    <div
      ref={setScrollRef}
      onScroll={onScroll}
      class="min-h-0 flex-1 overflow-auto px-1"
      data-testid="ref-tree-scroll"
    >
      <div class="relative" style={{ height: `${totalHeight()}px` }}>
        <For each={virtualItems()}>
          {(virtualItem) => (
            <VirtualRefTreeRow
              index={virtualItem.index}
              top={virtualItem.start}
              rows={rows}
              localLoading={props.loading ?? false}
              visibleTimelineRefs={props.visibleTimelineRefs}
              onToggleCollapsed={toggle}
              onToggleTimelineVisibility={props.onToggleTimelineVisibility}
              onCheckoutRef={props.onCheckoutRef}
            />
          )}
        </For>
      </div>
    </div>
  )
}
