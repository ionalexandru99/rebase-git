import { Check, ChevronDown, ChevronRight, Cloud, GitBranch, Tag } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  folderKey,
  REF_TREE_INDENT_PX,
  REF_TREE_ROW_HEIGHT,
  type RefKind,
  type RefRow,
  sectionKey
} from '@/lib/ref-tree'
import { cn } from '@/lib/utils'

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
      <button
        type="button"
        onClick={() => onToggleCollapsed(sectionKey(row.refKind))}
        className="absolute inset-x-0 flex items-center gap-1 px-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
        style={baseStyle}
      >
        <Chevron expanded={row.expanded} />
        <span>{row.label}</span>
        {loading ? (
          <Skeleton className="ml-auto h-2 w-4 rounded-sm" />
        ) : (
          <span className="ml-auto pr-1 tabular-nums opacity-60">{row.count}</span>
        )}
      </button>
    )
  }

  if (row.kind === 'empty') {
    return (
      <div
        className="absolute inset-x-0 flex items-center px-6 text-xs text-muted-foreground/70"
        style={baseStyle}
      >
        {row.label}
      </div>
    )
  }

  if (row.kind === 'skeleton') {
    const widths = ['60%', '78%', '52%', '70%']
    const width = widths[row.idx % widths.length]
    return (
      <div className="absolute inset-x-0 flex items-center gap-1.5 pr-2 pl-5" style={baseStyle}>
        <Skeleton className="size-3.5 shrink-0 rounded-sm opacity-60" />
        <Skeleton className="h-2.5 rounded" style={{ width, opacity: 0.6 }} />
      </div>
    )
  }

  if (row.kind === 'folder') {
    const padLeft = 6 + row.depth * REF_TREE_INDENT_PX
    return (
      <button
        type="button"
        onClick={() => onToggleCollapsed(folderKey(row.refKind, row.fullPath))}
        className="absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm text-foreground/85 hover:bg-sidebar-accent/60 hover:text-foreground"
        style={{ ...baseStyle, paddingLeft: padLeft }}
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

  const Icon = row.refKind === 'tag' ? Tag : row.refKind === 'remote' ? Cloud : GitBranch
  const padLeft = 6 + row.depth * REF_TREE_INDENT_PX + 14
  const refKind = row.refKind
  const fullPath = row.fullPath
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => onSelectLeaf?.(refKind, fullPath)}
          onDoubleClick={() => onCheckoutLeaf?.(refKind, fullPath)}
          className={cn(
            'absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm hover:bg-sidebar-accent/60',
            row.isCurrent
              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
              : 'text-foreground/90'
          )}
          style={{ ...baseStyle, paddingLeft: padLeft }}
          title={fullPath}
        >
          {row.isCurrent && (
            <span
              aria-hidden
              data-testid="current-ref-bar"
              className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-sm bg-sidebar-primary"
            />
          )}
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{row.name}</span>
          {row.isCurrent && (
            <Check
              aria-hidden
              data-testid="current-ref-check"
              className="ml-auto size-3.5 shrink-0 text-sidebar-primary"
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onCheckoutLeaf?.(refKind, fullPath)}>
          Checkout
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function Chevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
  )
}
