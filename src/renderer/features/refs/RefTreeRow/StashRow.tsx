import { Archive } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RefStashRow } from '@/features/refs/ref-tree'
import type { StashAction } from '@/lib/git-actions'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../../components/ui/context-menu'

interface StashRowProps {
  row: RefStashRow
  style: CSSProperties
  onStashAction?: (action: StashAction, index: number, expectedOid: string) => void
}

export function StashRow(props: StashRowProps) {
  const act = (action: StashAction) => props.onStashAction?.(action, props.row.index, props.row.oid)
  const title = `stash@{${props.row.index}} (on ${props.row.branch}): ${props.row.message}`

  return (
    <ContextMenu>
      <div
        className="group/stash-row absolute inset-x-0 flex items-center rounded-[var(--r-sm)] pr-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        style={props.style}
        data-testid="ref-tree-stash-row"
      >
        <ContextMenuTrigger
          as="button"
          type="button"
          onDoubleClick={() => act('apply')}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-sm)] py-0 pr-0 pl-[22px] text-sm"
          title={title}
        >
          <Archive className="size-3.5 shrink-0 text-amber-500" />
          <span className="min-w-0 truncate text-left">{props.row.message}</span>
        </ContextMenuTrigger>
      </div>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => act('apply')}>Apply</ContextMenuItem>
        <ContextMenuItem onSelect={() => act('pop')}>Pop</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => act('drop')}>
          Drop
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
