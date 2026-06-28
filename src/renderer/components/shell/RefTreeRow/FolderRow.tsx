import type { CSSProperties } from 'react'
import { folderKey, REF_TREE_INDENT_PX, type RefFolderRow } from '@/lib/ref-tree'
import { Chevron } from './Chevron'

interface FolderRowProps {
  row: RefFolderRow
  style: CSSProperties
  onToggleCollapsed: (key: string) => void
}

export function FolderRow(props: FolderRowProps) {
  const padLeft = 8 + (props.row.depth - 1) * REF_TREE_INDENT_PX
  return (
    <button
      type="button"
      onClick={() => props.onToggleCollapsed(folderKey(props.row.refKind, props.row.fullPath))}
      className="absolute inset-x-0 flex items-center gap-1.5 rounded-[var(--r-sm)] pr-2 text-sm text-foreground hover:bg-muted"
      style={{ ...props.style, paddingLeft: `${padLeft}px` }}
      title={props.row.fullPath}
    >
      <Chevron expanded={props.row.expanded} />
      <span className="min-w-0 truncate">{props.row.name}</span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {props.row.childCount}
      </span>
    </button>
  )
}
