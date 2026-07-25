import type { CSSProperties } from 'react'
import { refFilterKey } from '@/features/history/selectors'
import { REF_TREE_ROW_HEIGHT, type RefKind, type RefRow } from '@/features/refs/ref-tree'
import type { BranchAction, StashAction } from '@/lib/git-actions'
import { EmptyRow } from './EmptyRow'
import { FolderRow } from './FolderRow'
import { LeafRow } from './LeafRow'
import { SectionRow } from './SectionRow'
import { SkeletonRowItem } from './SkeletonRow'
import { StashRow } from './StashRow'

interface RefTreeRowProps {
  row: RefRow
  top: number
  localLoading: boolean
  currentBranch?: string
  visibleTimelineRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
}

export function RefTreeRow(props: RefTreeRowProps) {
  const baseStyle: CSSProperties = {
    top: '0',
    height: `${REF_TREE_ROW_HEIGHT}px`,
    transform: `translateY(${props.top}px)`,
    contain: 'layout paint style'
  }

  switch (props.row.kind) {
    case 'section':
      return (
        <SectionRow
          row={props.row}
          style={baseStyle}
          loading={props.localLoading && props.row.refKind === 'local'}
          onToggleCollapsed={props.onToggleCollapsed}
        />
      )
    case 'empty':
      return <EmptyRow row={props.row} style={baseStyle} />
    case 'skeleton':
      return <SkeletonRowItem row={props.row} style={baseStyle} />
    case 'folder':
      return (
        <FolderRow row={props.row} style={baseStyle} onToggleCollapsed={props.onToggleCollapsed} />
      )
    case 'stash':
      return <StashRow row={props.row} style={baseStyle} onStashAction={props.onStashAction} />
    case 'leaf':
      return (
        <LeafRow
          row={props.row}
          style={baseStyle}
          currentBranch={props.currentBranch}
          onBranchAction={props.onBranchAction}
          timelineVisible={
            props.visibleTimelineRefs?.has(refFilterKey(props.row.refKind, props.row.fullPath)) ??
            false
          }
          onToggleTimelineVisibility={props.onToggleTimelineVisibility}
          onCheckoutLeaf={props.onCheckoutLeaf}
        />
      )
  }
}
