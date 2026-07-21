import type { HeadDropState } from '@/lib/amend-drops'
import type { FileAction } from '@/lib/git-actions'
import type { FileRowSource, FileStageState } from '@/lib/status-file-rows'
import { cn } from '@/lib/utils'
import { Checkbox } from '../ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTriggerArea
} from '../ui/context-menu'
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

  const nameButton = (
    <button type="button" onClick={select} className="flex h-full min-w-0 items-center text-left">
      <span className="min-w-0 truncate text-sm" title={label}>
        {label}
      </span>
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
        {isStaged ? (
          <ContextMenuItem onSelect={unstage}>Unstage</ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={() => props.onStage?.(props.file)}>Stage</ContextMenuItem>
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
