import type { HeadDropState } from '@/features/commit/amend-drops'
import {
  type ConflictLabels,
  type ConflictSide,
  conflictRowActions
} from '@/features/status/conflict-resolution'
import type { FileRowSource, FileStageState } from '@/features/status/status-file-rows'
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
  stageState: FileStageState
  source?: FileRowSource
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
  showSource?: boolean
}

const ROW_GRID =
  'grid h-8 grid-cols-[15px_18px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-sm)] px-2 transition-colors'

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

  const showSourceBadge = props.showSource ?? props.source === 'head-commit'

  const nameButton = (
    <button
      type="button"
      onClick={select}
      className="flex h-full min-w-0 items-center gap-1.5 text-left"
    >
      <span className="min-w-0 truncate text-sm" title={label}>
        {label}
      </span>
      {showSourceBadge ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {props.source === 'head-commit' ? 'Last commit' : 'Working tree'}
        </span>
      ) : null}
    </button>
  )

  if (props.source === 'head-commit') {
    const dropState = props.dropState ?? 'kept'
    const kept = dropState === 'kept'
    return (
      <ContextMenu>
        <ContextMenuTriggerArea className={rowClass} data-testid="status-file-row">
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

  const isStaged = props.stageState === 'staged'
  const isConflicted = props.kind === 'conflicted' && Boolean(props.onResolveConflict)
  const conflict = isConflicted
    ? conflictRowActions(props.conflictCode, props.conflictLabels ?? null)
    : null

  const toggleStaged = () => {
    if (isStaged) {
      unstage()
      return
    }
    props.onStage?.(props.file)
  }

  return (
    <ContextMenu>
      <ContextMenuTriggerArea className={rowClass} data-testid="status-file-row">
        <Checkbox
          checked={isStaged}
          indeterminate={props.stageState === 'partial'}
          aria-label={isStaged ? `Unstage ${label}` : `Stage ${label}`}
          onChange={() => toggleStaged()}
        />
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
        <ContextMenuItem variant="destructive" onSelect={() => fileAction('discard')}>
          Discard changes
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => props.onFileAction?.('copy-path', props.file)}>
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
