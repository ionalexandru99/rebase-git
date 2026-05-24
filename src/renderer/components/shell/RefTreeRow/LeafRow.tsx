import { Check, Cloud, GitBranch, Tag } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { REF_TREE_INDENT_PX, type RefKind, type RefLeafRow } from '@/lib/ref-tree'
import { cn } from '@/lib/utils'
import { AheadBehindBadge } from './AheadBehindBadge'

interface LeafRowProps {
  row: RefLeafRow
  style: React.CSSProperties
  onSelectLeaf?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
}

const iconFor: Record<RefKind, typeof GitBranch> = {
  local: GitBranch,
  remote: Cloud,
  tag: Tag
}

export function LeafRow({ row, style, onSelectLeaf, onCheckoutLeaf }: LeafRowProps) {
  const Icon = iconFor[row.refKind]
  const padLeft = 6 + row.depth * REF_TREE_INDENT_PX + 14
  const { refKind, fullPath } = row

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
          style={{ ...style, paddingLeft: padLeft }}
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
          <span className="min-w-0 truncate text-left">{row.name}</span>
          <AheadBehindBadge ahead={row.ahead} behind={row.behind} />
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
