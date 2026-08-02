import { SearchIcon, XIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useDeferredValue, useMemo, useState } from 'react'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  type RefRow,
  rowKey,
  type StashRowData
} from '@/features/refs/ref-tree'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { useFixedVirtualizer } from '../../hooks/useFixedVirtualizer'
import { RefTreeRow } from './RefTreeRow'

export interface RefTreePanelViewProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  stashes?: StashRowData[]
  currentBranch: string
  loading?: boolean
  tracking?: Record<string, BranchTracking>
  toggles: Set<string>
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
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
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
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

export function RefTreePanelView(props: RefTreePanelViewProps) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const rows = useMemo(
    () =>
      buildRefTreeRows({
        localBranches: props.localBranches,
        remoteBranches: props.remoteBranches,
        tags: props.tags,
        toggles: props.toggles,
        currentBranch: props.currentBranch,
        localLoading: props.loading ?? false,
        tracking: props.tracking,
        stashes: props.stashes,
        query: deferredQuery
      }),
    [
      props.localBranches,
      props.remoteBranches,
      props.tags,
      props.toggles,
      props.currentBranch,
      props.loading,
      props.tracking,
      props.stashes,
      deferredQuery
    ]
  )

  const { setScrollRef, onScroll, virtualItems, totalHeight, virtualizer } = useFixedVirtualizer({
    count: rows.length,
    rowHeight: REF_TREE_ROW_HEIGHT,
    overscan: REF_TREE_OVERSCAN,
    initialViewportHeight: 400
  })

  const handleQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query.length > 0) {
      event.preventDefault()
      setQuery('')
    }
  }

  const toggle = (key: string) => {
    props.onToggleCollapsed(key)
    queueMicrotask(() => {
      virtualizer.measure()
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <div className="flex h-8 items-center gap-2 rounded-[var(--r-sm)] border bg-background px-2.5 text-muted-foreground transition-shadow focus-within:border-[var(--brand-line)] focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <SearchIcon className="size-3.5 shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={handleQueryKeyDown}
            placeholder="Filter refs…"
            aria-label="Filter refs"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query.length > 0 ? (
            <button
              type="button"
              aria-label="Clear filter"
              className="flex size-5 shrink-0 items-center justify-center rounded-[var(--r-xs)] hover:text-foreground"
              onClick={() => setQuery('')}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={setScrollRef}
        onScroll={onScroll}
        className="scroll-host min-h-0 flex-1 overflow-auto px-2 pb-2 pt-3 [scrollbar-gutter:stable]"
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
    </div>
  )
}
