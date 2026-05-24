import { REF_TREE_ROW_HEIGHT, type RefKind, type RefRow } from '@/lib/ref-tree'
import { EmptyRow } from './EmptyRow'
import { FolderRow } from './FolderRow'
import { LeafRow } from './LeafRow'
import { SectionRow } from './SectionRow'
import { SkeletonRowItem } from './SkeletonRow'

interface RefTreeRowProps {
  row: RefRow
  top: number
  loading: boolean
  onToggleCollapsed: (key: string) => void
  onSelectLeaf?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
}

export function RefTreeRow({
  row,
  top,
  loading,
  onToggleCollapsed,
  onSelectLeaf,
  onCheckoutLeaf
}: RefTreeRowProps) {
  const baseStyle: React.CSSProperties = {
    top: 0,
    height: REF_TREE_ROW_HEIGHT,
    transform: `translateY(${top}px)`,
    contain: 'layout paint style'
  }

  if (row.kind === 'section') {
    return (
      <SectionRow
        row={row}
        style={baseStyle}
        loading={loading}
        onToggleCollapsed={onToggleCollapsed}
      />
    )
  }

  if (row.kind === 'empty') {
    return <EmptyRow row={row} style={baseStyle} />
  }

  if (row.kind === 'skeleton') {
    return <SkeletonRowItem row={row} style={baseStyle} />
  }

  if (row.kind === 'folder') {
    return <FolderRow row={row} style={baseStyle} onToggleCollapsed={onToggleCollapsed} />
  }

  return (
    <LeafRow
      row={row}
      style={baseStyle}
      onSelectLeaf={onSelectLeaf}
      onCheckoutLeaf={onCheckoutLeaf}
    />
  )
}
