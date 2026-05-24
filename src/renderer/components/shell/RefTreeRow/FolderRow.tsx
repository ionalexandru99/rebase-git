import { folderKey, REF_TREE_INDENT_PX, type RefFolderRow } from '@/lib/ref-tree'
import { Chevron } from './Chevron'

interface FolderRowProps {
  row: RefFolderRow
  style: React.CSSProperties
  onToggleCollapsed: (key: string) => void
}

export function FolderRow({ row, style, onToggleCollapsed }: FolderRowProps) {
  const padLeft = 6 + row.depth * REF_TREE_INDENT_PX
  return (
    <button
      type="button"
      onClick={() => onToggleCollapsed(folderKey(row.refKind, row.fullPath))}
      className="absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm text-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground"
      style={{ ...style, paddingLeft: padLeft }}
      title={row.fullPath}
    >
      <Chevron expanded={row.expanded} />
      <span className="truncate">{row.name}</span>
      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/70">
        {row.childCount}
      </span>
    </button>
  )
}
