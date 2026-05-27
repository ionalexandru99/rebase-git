import {
  CheckIcon,
  CloudIcon,
  EyeIcon,
  EyeOffIcon,
  GitBranchIcon,
  type LucideProps,
  TagIcon
} from 'lucide-react'
import type { MouseEvent } from 'react'
import { type Component, Dynamic, type JSX, Show } from '@/lib/react-compat'
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
  timelineVisible?: boolean
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
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
  const showTimelineEye = () => props.row.refKind === 'local' || props.row.refKind === 'remote'

  const handleToggleVisibility = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    props.onToggleTimelineVisibility?.(props.row.refKind, props.row.fullPath)
  }

  return (
    <ContextMenu>
      <div
        className={cn(
          'group/branch-row absolute inset-x-0 flex items-center rounded-sm pr-1 hover:bg-sidebar-accent/60',
          props.row.isCurrent
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-foreground/90'
        )}
        style={props.style}
        data-testid="ref-tree-leaf-row"
      >
        <ContextMenuTrigger
          as="button"
          type="button"
          onDoubleClick={() => props.onCheckoutLeaf?.(props.row.refKind, props.row.fullPath)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0 pr-0 text-sm"
          style={{ paddingLeft: `${padLeft()}px` }}
          title={props.row.fullPath}
        >
          <Show when={props.row.isCurrent}>
            <span
              aria-hidden="true"
              data-testid="current-ref-bar"
              className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-sm bg-sidebar-primary"
            />
          </Show>
          <Dynamic component={icon()} className="size-3.5 shrink-0 opacity-70" />
          <span className="min-w-0 truncate text-left">{props.row.name}</span>
          <AheadBehindBadge ahead={props.row.ahead} behind={props.row.behind} />
          <Show when={props.row.isCurrent}>
            <CheckIcon
              aria-hidden="true"
              data-testid="current-ref-check"
              className="ml-auto size-3.5 shrink-0 text-sidebar-primary"
            />
          </Show>
        </ContextMenuTrigger>

        <Show when={showTimelineEye()}>
          <button
            type="button"
            data-testid="timeline-visibility-toggle"
            className={cn(
              'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground',
              props.timelineVisible
                ? 'opacity-100'
                : 'opacity-0 group-hover/branch-row:opacity-100 group-focus-within/branch-row:opacity-100 focus-visible:opacity-100'
            )}
            aria-pressed={props.timelineVisible ?? false}
            aria-label={
              props.timelineVisible
                ? `Hide ${props.row.fullPath} from timeline`
                : `Show ${props.row.fullPath} on timeline`
            }
            title={
              props.timelineVisible ? 'Visible on timeline' : 'Hidden from timeline — click to show'
            }
            onClick={handleToggleVisibility}
          >
            <Show when={props.timelineVisible} fallback={<EyeOffIcon className="size-3.5" />}>
              <EyeIcon className="size-3.5" />
            </Show>
          </button>
        </Show>
      </div>
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
