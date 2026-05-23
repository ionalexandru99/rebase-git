import { decodeOrThrow } from '@shared/codec'
import { RefTreeToggles } from '@shared/schemas/ipc'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useVirtualList } from '@/hooks/useVirtualList'
import {
  type BranchTracking,
  buildRefTreeRows,
  REF_TREE_OVERSCAN,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  rowKey
} from '@/lib/ref-tree'
import { RefTreeRow } from './RefTreeRow'

export type { RefKind } from '@/lib/ref-tree'

interface RefTreePanelProps {
  localBranches: string[]
  remoteBranches: string[]
  tags: string[]
  currentBranch: string
  loading?: boolean
  tracking?: Record<string, BranchTracking>
  onSelectRef?: (refKind: RefKind, fullPath: string) => void
  onCheckoutRef?: (refKind: RefKind, fullPath: string) => void
}

export const RefTreePanel = memo(function RefTreePanel({
  localBranches,
  remoteBranches,
  tags,
  currentBranch,
  loading = false,
  tracking,
  onSelectRef,
  onCheckoutRef
}: RefTreePanelProps) {
  const [toggles, setToggles] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getRefTreeToggles()
      .then((res) => {
        if (cancelled) return
        const decoded = decodeOrThrow(RefTreeToggles, res)
        setToggles(new Set(decoded))
      })
      .catch((err: unknown) => {
        console.warn('[RefTreePanel] failed to load toggles', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = useCallback((key: string) => {
    setToggles((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      window.electronAPI.setRefTreeToggles([...next])
      return next
    })
  }, [])

  const rows = useMemo(
    () =>
      buildRefTreeRows({
        localBranches,
        remoteBranches,
        tags,
        toggles,
        currentBranch,
        loading,
        tracking
      }),
    [localBranches, remoteBranches, tags, currentBranch, toggles, loading, tracking]
  )

  const { scrollRef, onScroll, startIndex, endIndex, totalHeight } = useVirtualList({
    rowCount: rows.length,
    rowHeight: REF_TREE_ROW_HEIGHT,
    overscan: REF_TREE_OVERSCAN,
    initialViewportHeight: 400
  })

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-auto px-1"
      data-testid="ref-tree-scroll"
    >
      <div className="relative" style={{ height: totalHeight }}>
        {rows.slice(startIndex, endIndex).map((row, idx) => {
          const i = startIndex + idx
          return (
            <RefTreeRow
              key={rowKey(row)}
              row={row}
              top={i * REF_TREE_ROW_HEIGHT}
              loading={loading}
              onToggleCollapsed={toggle}
              onSelectLeaf={onSelectRef}
              onCheckoutLeaf={onCheckoutRef}
            />
          )
        })}
      </div>
    </div>
  )
})
