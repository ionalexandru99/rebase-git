import type { JSX } from 'solid-js'
import { folderKey, REF_TREE_INDENT_PX, type RefFolderRow } from '@/lib/ref-tree'
import { Chevron } from './Chevron'

interface FolderRowProps {
  row: RefFolderRow
  style: JSX.CSSProperties
  onToggleCollapsed: (key: string) => void
}

export function FolderRow(props: FolderRowProps) {
  const padLeft = () => 6 + props.row.depth * REF_TREE_INDENT_PX
  return (
    <button
      type="button"
      onClick={() => props.onToggleCollapsed(folderKey(props.row.refKind, props.row.fullPath))}
      class="absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm text-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground"
      style={{ ...props.style, 'padding-left': `${padLeft()}px` }}
      title={props.row.fullPath}
    >
      <Chevron expanded={props.row.expanded} />
      <span class="truncate">{props.row.name}</span>
    </button>
  )
}
