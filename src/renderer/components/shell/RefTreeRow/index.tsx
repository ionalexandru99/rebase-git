import { refFilterKey } from '@/components/HistoryPanel/selectors'
import type { BranchAction } from '@/lib/git-actions'
import { type JSX, Match, Switch } from '@/lib/react-compat'
import { REF_TREE_ROW_HEIGHT, type RefKind, type RefRow } from '@/lib/ref-tree'
import { EmptyRow } from './EmptyRow'
import { FolderRow } from './FolderRow'
import { LeafRow } from './LeafRow'
import { SectionRow } from './SectionRow'
import { SkeletonRowItem } from './SkeletonRow'

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
}

export function RefTreeRow(props: RefTreeRowProps) {
  const baseStyle = (): JSX.CSSProperties => ({
    top: '0',
    height: `${REF_TREE_ROW_HEIGHT}px`,
    transform: `translateY(${props.top}px)`,
    contain: 'layout paint style'
  })

  return (
    <Switch>
      <Match when={props.row.kind === 'section'}>
        <SectionRow
          row={props.row as Extract<RefRow, { kind: 'section' }>}
          style={baseStyle()}
          loading={props.localLoading && props.row.refKind === 'local'}
          onToggleCollapsed={props.onToggleCollapsed}
        />
      </Match>
      <Match when={props.row.kind === 'empty'}>
        <EmptyRow row={props.row as Extract<RefRow, { kind: 'empty' }>} style={baseStyle()} />
      </Match>
      <Match when={props.row.kind === 'skeleton'}>
        <SkeletonRowItem
          row={props.row as Extract<RefRow, { kind: 'skeleton' }>}
          style={baseStyle()}
        />
      </Match>
      <Match when={props.row.kind === 'folder'}>
        <FolderRow
          row={props.row as Extract<RefRow, { kind: 'folder' }>}
          style={baseStyle()}
          onToggleCollapsed={props.onToggleCollapsed}
        />
      </Match>
      <Match when={props.row.kind === 'leaf'}>
        <LeafRow
          row={props.row as Extract<RefRow, { kind: 'leaf' }>}
          style={baseStyle()}
          currentBranch={props.currentBranch}
          onBranchAction={props.onBranchAction}
          timelineVisible={
            props.visibleTimelineRefs?.has(
              refFilterKey(
                (props.row as Extract<RefRow, { kind: 'leaf' }>).refKind,
                (props.row as Extract<RefRow, { kind: 'leaf' }>).fullPath
              )
            ) ?? false
          }
          onToggleTimelineVisibility={props.onToggleTimelineVisibility}
          onCheckoutLeaf={props.onCheckoutLeaf}
        />
      </Match>
    </Switch>
  )
}
