import { EyeIcon, EyeOffIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { BranchAction } from '@/lib/git-actions'
import { type JSX, Show } from '@/lib/react-compat'
import { REF_TREE_INDENT_PX, type RefKind, type RefLeafRow } from '@/lib/ref-tree'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../ui/context-menu'
import { AheadBehindBadge } from './AheadBehindBadge'

interface LeafRowProps {
  row: RefLeafRow
  style: JSX.CSSProperties
  currentBranch?: string
  timelineVisible?: boolean
  onToggleTimelineVisibility?: (refKind: RefKind, fullPath: string) => void
  onCheckoutLeaf?: (refKind: RefKind, fullPath: string) => void
  onBranchAction?: (action: BranchAction, refKind: RefKind, fullPath: string) => void
}

type MenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item'
      label: string
      onSelect: () => void
      variant?: 'destructive'
      disabled?: boolean
    }

export function LeafRow(props: LeafRowProps) {
  const padLeft = () => 22 + (props.row.depth - 1) * REF_TREE_INDENT_PX
  const showTimelineEye = () => props.row.refKind === 'local' || props.row.refKind === 'remote'

  const handleToggleVisibility = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    props.onToggleTimelineVisibility?.(props.row.refKind, props.row.fullPath)
  }

  const checkout = () => props.onCheckoutLeaf?.(props.row.refKind, props.row.fullPath)
  const act = (action: BranchAction) =>
    props.onBranchAction?.(action, props.row.refKind, props.row.fullPath)

  const menuEntries = (): MenuEntry[] => {
    const { refKind, isCurrent } = props.row
    const current = props.currentBranch
    const mergeLabel = current ? `Merge into ${current}` : 'Merge into current branch'
    if (refKind === 'tag') {
      return [
        { kind: 'item', label: 'Checkout', onSelect: checkout },
        { kind: 'item', label: 'New branch from here', onSelect: () => act('new-branch') },
        { kind: 'separator' },
        { kind: 'item', label: 'Copy tag name', onSelect: () => act('copy-name') },
        {
          kind: 'item',
          label: 'Delete tag',
          onSelect: () => act('delete-tag'),
          variant: 'destructive'
        }
      ]
    }
    const entries: MenuEntry[] = [
      { kind: 'item', label: 'Checkout', onSelect: checkout, disabled: isCurrent },
      {
        kind: 'item',
        label: mergeLabel,
        onSelect: () => act('merge'),
        disabled: isCurrent || !current
      },
      { kind: 'separator' },
      { kind: 'item', label: 'New branch from here', onSelect: () => act('new-branch') },
      { kind: 'item', label: 'Create tag here', onSelect: () => act('create-tag') }
    ]
    if (refKind === 'local') {
      entries.push({ kind: 'item', label: 'Rename…', onSelect: () => act('rename') })
    }
    entries.push({ kind: 'separator' })
    entries.push({ kind: 'item', label: 'Copy branch name', onSelect: () => act('copy-name') })
    if (refKind === 'local') {
      entries.push({
        kind: 'item',
        label: 'Delete',
        onSelect: () => act('delete'),
        variant: 'destructive',
        disabled: isCurrent
      })
    }
    return entries
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
          onDoubleClick={() => checkout()}
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
        {menuEntries().map((entry, index) =>
          entry.kind === 'separator' ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: static menu, order is stable
            <ContextMenuSeparator key={`sep-${index}`} />
          ) : (
            <ContextMenuItem
              key={entry.label}
              variant={entry.variant}
              disabled={entry.disabled}
              onSelect={entry.onSelect}
            >
              {entry.label}
            </ContextMenuItem>
          )
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
