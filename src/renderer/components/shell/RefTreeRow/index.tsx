import { type JSX, Match, Switch } from 'solid-js'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
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
  filterActive?: boolean
  selectedFilterRefs?: ReadonlySet<string>
  onToggleCollapsed: (key: string) => void
  onSelectLeaf?: (refKind: RefKind, fullPath: string) => void
  onToggleFilterRef?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
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
          loading={props.loading}
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
          filterActive={props.filterActive}
          filterSelected={
            props.selectedFilterRefs?.has(
              refFilterKey(
                (props.row as Extract<RefRow, { kind: 'leaf' }>).refKind,
                (props.row as Extract<RefRow, { kind: 'leaf' }>).fullPath
              )
            ) ?? false
          }
          onSelectLeaf={props.onSelectLeaf}
          onToggleFilterRef={props.onToggleFilterRef}
          onCheckoutLeaf={props.onCheckoutLeaf}
        />
      </Match>
    </Switch>
  )
}
