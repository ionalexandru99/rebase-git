import { CheckIcon, CloudIcon, GitBranchIcon, type LucideProps, TagIcon } from 'lucide-solid'
import { type Component, type JSX, Show } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { REF_TREE_INDENT_PX, type RefKind, type RefLeafRow } from '@/lib/ref-tree'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../../ui/context-menu'
import { AheadBehindBadge } from './AheadBehindBadge'

interface LeafRowProps {
  row: RefLeafRow
  style: JSX.CSSProperties
  filterActive?: boolean
  filterSelected?: boolean
  onSelectLeaf?: (refKind: RefKind, fullPath: string) => void
  onToggleFilterRef?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
}

const iconFor: Record<RefKind, Component<LucideProps>> = {
  local: GitBranchIcon,
  remote: CloudIcon,
  tag: TagIcon
}

export function LeafRow(props: LeafRowProps) {
  const icon = () => iconFor[props.row.refKind]
  const padLeft = () => 6 + props.row.depth * REF_TREE_INDENT_PX + 14
  const showFilterCheckbox = () =>
    props.filterActive && (props.row.refKind === 'local' || props.row.refKind === 'remote')

  const handleClick = () => {
    if (props.filterActive && showFilterCheckbox()) {
      props.onToggleFilterRef?.(props.row.refKind, props.row.fullPath)
      return
    }
    props.onSelectLeaf?.(props.row.refKind, props.row.fullPath)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="button"
        type="button"
        onClick={handleClick}
        onDblClick={() => props.onCheckoutLeaf?.(props.row.refKind, props.row.fullPath)}
        class={cn(
          'absolute inset-x-0 flex items-center gap-1.5 rounded-sm pr-2 text-sm hover:bg-sidebar-accent/60',
          props.row.isCurrent
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-foreground/90',
          props.filterSelected && 'ring-1 ring-inset ring-sidebar-primary/40'
        )}
        style={{ ...props.style, 'padding-left': `${padLeft()}px` }}
        title={props.row.fullPath}
        aria-pressed={props.filterActive ? props.filterSelected : undefined}
      >
        <Show when={showFilterCheckbox()}>
          <span
            data-testid="ref-filter-checkbox"
            aria-hidden="true"
            class={cn(
              'flex size-3.5 shrink-0 items-center justify-center rounded-sm border',
              props.filterSelected
                ? 'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground'
                : 'border-muted-foreground/40 bg-background'
            )}
          >
            <Show when={props.filterSelected}>
              <CheckIcon class="size-2.5" />
            </Show>
          </span>
        </Show>
        <Show when={props.row.isCurrent}>
          <span
            aria-hidden="true"
            data-testid="current-ref-bar"
            class="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-sm bg-sidebar-primary"
          />
        </Show>
        <Dynamic component={icon()} class="size-3.5 shrink-0 opacity-70" />
        <span class="min-w-0 truncate text-left">{props.row.name}</span>
        <AheadBehindBadge ahead={props.row.ahead} behind={props.row.behind} />
        <Show when={props.row.isCurrent}>
          <CheckIcon
            aria-hidden="true"
            data-testid="current-ref-check"
            class="ml-auto size-3.5 shrink-0 text-sidebar-primary"
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => props.onCheckoutLeaf?.(props.row.refKind, props.row.fullPath)}
        >
          Checkout
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
