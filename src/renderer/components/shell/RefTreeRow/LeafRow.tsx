import { EyeIcon, EyeOffIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { type JSX, Show } from '@/lib/react-compat'
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

export function LeafRow(props: LeafRowProps) {
  const padLeft = () => 22 + (props.row.depth - 1) * REF_TREE_INDENT_PX
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
          'group/branch-row absolute inset-x-0 flex items-center rounded-[var(--r-sm)] pr-1 transition-colors hover:bg-muted hover:text-foreground',
          props.row.isCurrent ? 'text-foreground' : 'text-muted-foreground'
        )}
        style={props.style}
        data-testid="ref-tree-leaf-row"
      >
        <ContextMenuTrigger
          as="button"
          type="button"
          onDoubleClick={() => props.onCheckoutLeaf?.(props.row.refKind, props.row.fullPath)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-sm)] py-0 pr-0 text-sm"
          style={{ paddingLeft: `${padLeft()}px` }}
          title={props.row.fullPath}
        >
          <span
            className={cn('min-w-0 truncate text-left', props.row.isCurrent && 'font-semibold')}
          >
            {props.row.name}
          </span>
          <Show when={props.row.isCurrent}>
            <span
              data-testid="current-ref-check"
              className="inline-flex h-[18px] shrink-0 items-center rounded-[var(--r-xs)] bg-green/15 px-1.5 text-[11px] font-semibold lowercase leading-none text-green"
            >
              current
            </span>
          </Show>
          <AheadBehindBadge ahead={props.row.ahead} behind={props.row.behind} />
        </ContextMenuTrigger>

        <Show when={showTimelineEye()}>
          <button
            type="button"
            data-testid="timeline-visibility-toggle"
            className={cn(
              'mr-0.5 flex size-7 shrink-0 items-center justify-center rounded-[var(--r-xs)] text-muted-foreground hover:text-foreground',
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
