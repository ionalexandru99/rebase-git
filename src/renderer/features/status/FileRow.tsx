import { MinusIcon, PlusIcon } from 'lucide-react'
import type { HeadDropState } from '@/features/commit/amend-drops'
import {
  type ConflictLabels,
  type ConflictSide,
  conflictRowActions
} from '@/features/status/conflict-resolution'
import type { FileRowGroup } from '@/features/status/status-groups'
import type { FileAction } from '@/lib/git-actions'
import { cn } from '@/lib/utils'
import { Checkbox } from '../../components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTriggerArea
} from '../../components/ui/context-menu'
import { StatusBadge, type StatusKind } from './StatusBadge'

interface FileRowProps {
  file: string
  renameSource?: string
  display?: string
  kind: StatusKind
  group: FileRowGroup
  dropState?: HeadDropState
  isSelected: boolean
  onSelect: (file: string, renameSource?: string) => void
  onStage?: (file: string) => void
  onUnstage?: (file: string, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  conflictCode?: string
  conflictLabels?: ConflictLabels
  onResolveConflict?: (file: string, side: ConflictSide) => void
}

const ROW_GRID =
  'group/file-row grid h-8 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--r-sm)] px-2 transition-colors'

export function FileRow(props: FileRowProps) {
  const label = props.display ?? props.file
  const rowClass = cn(ROW_GRID, props.isSelected ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted')
  const select = () => {
    if (props.renameSource) {
      props.onSelect(props.file, props.renameSource)
      return
    }
    props.onSelect(props.file)
  }
  const unstage = () => {
    if (props.renameSource) {
      props.onUnstage?.(props.file, props.renameSource)
      return
    }
    props.onUnstage?.(props.file)
  }
  const fileAction = (action: FileAction) => {
    if (props.renameSource) {
      props.onFileAction?.(action, props.file, props.renameSource)
      return
    }
    props.onFileAction?.(action, props.file)
  }

  const nameButton = (
    <button
      type="button"
      onClick={select}
      className="flex h-full min-w-0 items-center gap-1.5 text-left"
    >
      <span className="min-w-0 truncate text-sm" title={label}>
        {label}
      </span>
    </button>
  )

  if (props.group === 'head-commit') {
    const dropState = props.dropState ?? 'kept'
    const kept = dropState === 'kept'
    return (
      <ContextMenu>
        <ContextMenuTriggerArea
          className={rowClass}
          data-testid="status-file-row"
          data-group={props.group}
          data-file={props.file}
        >
          <Checkbox
            checked={kept}
            indeterminate={dropState === 'partial'}
            aria-label={kept ? `Drop ${label} from last commit` : `Keep ${label} in last commit`}
            onChange={() => props.onToggleDrop?.(props.file)}
          />
          <StatusBadge kind={props.kind} />
          {nameButton}
        </ContextMenuTriggerArea>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => props.onToggleDrop?.(props.file)}>
            {kept ? 'Drop from last commit' : 'Keep in last commit'}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => props.onFileAction?.('copy-path', props.file)}>
            Copy path
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const isStaged = props.group === 'staged'
  // What the file is, not what the caller wired up: the safety rules below (no silent discard, stage
  // means "mark resolved") hold for a conflicted file either way. Only the keep-a-side choices need
  // a resolver, so only they are withheld without one.
  const isConflicted = props.kind === 'conflicted'
  const conflict =
    isConflicted && props.onResolveConflict
      ? conflictRowActions(props.conflictCode, props.conflictLabels ?? null)
      : null

  const toggleStaged = () => {
    if (isStaged) {
      unstage()
      return
    }
    props.onStage?.(props.file)
  }
  const actionLabel = isStaged
    ? `Unstage ${label}`
    : isConflicted
      ? `Mark ${label} as resolved`
      : `Stage ${label}`

  return (
    <ContextMenu>
      <ContextMenuTriggerArea
        className={rowClass}
        data-testid="status-file-row"
        data-group={props.group}
        data-file={props.file}
        onDoubleClick={toggleStaged}
      >
        <StatusBadge kind={props.kind} />
        {nameButton}
        <button
          type="button"
          // A double-tap arrives as click, click, dblclick. The row stages on dblclick and this
          // button on click, so the repeat click is ignored and the dblclick is kept from reaching
          // the row — one gesture, one move. A keyboard activation carries detail 0 and still runs.
          onClick={(event) => {
            if (event.detail > 1) {
              return
            }
            toggleStaged()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={actionLabel}
          title={actionLabel}
          className="grid size-5 shrink-0 place-content-center rounded-[var(--r-xs)] text-muted-foreground opacity-0 transition-opacity hover:bg-card-2 hover:text-foreground focus-visible:opacity-100 group-hover/file-row:opacity-100"
        >
          {isStaged ? <MinusIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
        </button>
      </ContextMenuTriggerArea>
      <ContextMenuContent>
        {conflict ? (
          <>
            {conflict.choices.map((choice) => (
              <ContextMenuItem
                key={choice.side}
                onSelect={() => props.onResolveConflict?.(props.file, choice.side)}
              >
                {choice.label}
              </ContextMenuItem>
            ))}
            {conflict.note ? <ContextMenuLabel>{conflict.note}</ContextMenuLabel> : null}
            <ContextMenuSeparator />
          </>
        ) : null}
        {isStaged ? (
          <ContextMenuItem onSelect={unstage}>Unstage</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => props.onStage?.(props.file)}>
            {isConflicted ? 'Mark as resolved' : 'Stage'}
          </ContextMenuItem>
        )}
        {/* Discarding a conflicted file quietly resolves it to our side — the explicit Keep
            actions above say what they do, so the misleading item is withheld here. */}
        {isConflicted ? null : (
          <ContextMenuItem variant="destructive" onSelect={() => fileAction('discard')}>
            Discard changes
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => props.onFileAction?.('copy-path', props.file)}>
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
