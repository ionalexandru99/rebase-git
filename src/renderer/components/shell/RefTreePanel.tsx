import { parseOrThrow } from '@shared/codec'
import { filterPersistedRefTreeToggles } from '@shared/ref-tree-toggles'
import { RefTreeTogglesSchema } from '@shared/schemas/ipc'
import { useEffect, useMemo, useState } from 'react'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  type RefRow,
  rowKey,
  type StashRowData
} from '@/lib/ref-tree'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { RefTreeRow } from './RefTreeRow'

export type { RefKind } from '@/lib/ref-tree'

interface RefTreePanelProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  stashes?: StashRowData[]
  currentBranch: string
  loading?: boolean
  tracking?: Record<string, BranchTracking>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number) => void
}

interface VirtualRefTreeRowProps {
  index: number
  top: number
  rows: RefRow[]
  localLoading: boolean
  currentBranch: string
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number) => void
}

function VirtualRefTreeRow(props: VirtualRefTreeRowProps) {
  const row = props.rows[props.index]
  if (!row) {
    return null
  }
  return (
    <RefTreeRow
      row={row}
      top={props.top}
      localLoading={props.localLoading}
      currentBranch={props.currentBranch}
      visibleTimelineRefs={props.visibleTimelineRefs}
      onToggleCollapsed={props.onToggleCollapsed}
      onToggleTimelineVisibility={props.onToggleTimelineVisibility}
      onCheckoutLeaf={props.onCheckoutRef}
      onBranchAction={props.onBranchAction}
      onStashAction={props.onStashAction}
    />
  )
}

function persistToggles(next: Set<string>): void {
  window.electronAPI.setRefTreeToggles(filterPersistedRefTreeToggles([...next]))
}

export function RefTreePanel(props: RefTreePanelProps) {
  const [toggles, setToggles] = useState<Set<string>>(new Set())

  useEffect(() => {
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
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () =>
      buildRefTreeRows({
        localBranches: props.localBranches,
        remoteBranches: props.remoteBranches,
        tags: props.tags,
        toggles,
        currentBranch: props.currentBranch,
        localLoading: props.loading ?? false,
        tracking: props.tracking,
        stashes: props.stashes
      }),
    [
      props.localBranches,
      props.remoteBranches,
      props.tags,
      toggles,
      props.currentBranch,
      props.loading,
      props.tracking,
      props.stashes
    ]
  )

  const { setScrollRef, onScroll, virtualItems, totalHeight, virtualizer } = useFixedVirtualizer({
    count: rows.length,
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
      className="min-h-0 flex-1 overflow-auto px-2 pb-2 pt-3 [scrollbar-gutter:stable]"
      data-testid="ref-tree-scroll"
    >
      <div className="relative" style={{ height: `${totalHeight}px` }}>
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]
          return (
            <VirtualRefTreeRow
              key={row ? rowKey(row) : virtualItem.key}
              index={virtualItem.index}
              top={virtualItem.start}
              rows={rows}
              localLoading={props.loading ?? false}
              currentBranch={props.currentBranch}
              visibleTimelineRefs={props.visibleTimelineRefs}
              onToggleCollapsed={toggle}
              onToggleTimelineVisibility={props.onToggleTimelineVisibility}
              onCheckoutRef={props.onCheckoutRef}
              onBranchAction={props.onBranchAction}
              onStashAction={props.onStashAction}
            />
          )
        })}
      </div>
    </div>
  )
}
