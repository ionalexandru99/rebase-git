import { parseOrThrow } from '@shared/codec'
import { RefTreeTogglesSchema } from '@shared/schemas/ipc'
import { createMemo, createSignal, For, onCleanup, onMount } from 'solid-js'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind
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
  filterActive?: boolean
  selectedFilterRefs?: ReadonlySet<string>
  onSelectRef?: (refKind: RefKind, fullPath: string) => void
  onToggleFilterRef?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
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
        setToggles(new Set(decoded))
      })
      .catch((err: unknown) => {
        console.warn('[RefTreePanel] failed to load toggles', err)
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  const toggle = (key: string) => {
    setToggles((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      window.electronAPI.setRefTreeToggles([...next])
      return next
    })
  }

  const rows = createMemo(() =>
    buildRefTreeRows({
      localBranches: props.localBranches,
      remoteBranches: props.remoteBranches,
      tags: props.tags,
      toggles: toggles(),
      currentBranch: props.currentBranch,
      loading: props.loading ?? false,
      tracking: props.tracking
    })
  )

  const { setScrollRef, onScroll, virtualItems, totalHeight } = useFixedVirtualizer({
    count: () => rows().length,
    rowHeight: REF_TREE_ROW_HEIGHT,
    overscan: REF_TREE_OVERSCAN,
    initialViewportHeight: 400
  })

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
            <RefTreeRow
              row={rows()[virtualItem.index]}
              top={virtualItem.start}
              loading={props.loading ?? false}
              filterActive={props.filterActive}
              selectedFilterRefs={props.selectedFilterRefs}
              onToggleCollapsed={toggle}
              onSelectLeaf={props.onSelectRef}
              onToggleFilterRef={props.onToggleFilterRef}
              onCheckoutLeaf={props.onCheckoutRef}
            />
          )}
        </For>
      </div>
    </div>
  )
}
