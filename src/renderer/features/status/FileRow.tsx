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

const ROW_BASE =
  'group/file-row grid h-8 items-center gap-2 rounded-[var(--r-sm)] px-2 transition-colors'

const HEAD_ROW_GRID = `${ROW_BASE} grid-cols-[18px_minmax(0,1fr)_auto]`

const WORKTREE_ROW_GRID = `${ROW_BASE} grid-cols-[18px_auto_minmax(0,1fr)]`

type StageIndicatorState = 'conflicted' | 'staged' | 'unstaged'

const STAGE_INDICATORS: Record<StageIndicatorState, { glyph: string | null; className: string }> = {
  conflicted: { glyph: '!', className: 'border-orange bg-orange/15 text-orange' },
  staged: { glyph: '✓', className: 'border-add bg-add/15 text-add' },
  unstaged: { glyph: null, className: 'border-border-strong bg-card hover:border-brand' }
}

function StageIndicator(props: {
  state: StageIndicatorState
  label: string
  onToggle: () => void
}) {
  const indicator = STAGE_INDICATORS[props.state]
  return (
    <button
      type="button"
      data-testid="file-stage-indicator"
      data-state={props.state}
      aria-label={props.label}
      title={props.label}
      onClick={(event) => {
        if (event.detail > 1) {
          return
        }
        props.onToggle()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        'grid size-[15px] shrink-0 place-content-center rounded-[var(--r-xs)] border-[1.5px] text-[10px] font-bold leading-none transition-colors',
        indicator.className
      )}
    >
      {indicator.glyph}
    </button>
  )
}

export function FileRow(props: FileRowProps) {
  const label = props.display ?? props.file
  const rowClass = cn(
    props.group === 'head-commit' ? HEAD_ROW_GRID : WORKTREE_ROW_GRID,
    props.isSelected ? 'bg-[var(--brand-soft)]' : 'hover:bg-muted'
  )
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
  const indicatorState: StageIndicatorState = isConflicted
    ? 'conflicted'
    : isStaged
      ? 'staged'
      : 'unstaged'

  return (
    <ContextMenu>
      <ContextMenuTriggerArea
        className={rowClass}
        data-testid="status-file-row"
        data-group={props.group}
        data-file={props.file}
        onDoubleClick={toggleStaged}
      >
        <StageIndicator state={indicatorState} label={actionLabel} onToggle={toggleStaged} />
        <StatusBadge kind={props.kind} />
        {nameButton}
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
