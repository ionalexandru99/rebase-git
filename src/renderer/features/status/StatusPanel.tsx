import { type ReactNode, useMemo } from 'react'
import type { ConflictSide } from '@/features/status/conflict-resolution'
import type { UnifiedFileRow } from '@/features/status/status-file-rows'
import {
  buildStatusGroups,
  type FileRowGroup,
  type StatusGroup
} from '@/features/status/status-groups'
import type { FileAction } from '@/lib/git-actions'
import { useWorkingTreeStatus } from '@/stores/git'
import { LoadingBadge } from '../../components/ui/loading-badge'
import { StatusPanelSkeleton } from './Skeleton'
import { type FileListSection, type SelectedFile, VirtualFileList } from './VirtualFileList'

export type { SelectedFile } from './VirtualFileList'

interface StatusPanelProps {
  selected: SelectedFile | null
  onSelect: (file: string, group: FileRowGroup, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  amendRows?: UnifiedFileRow[]
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  onResolveConflict?: (file: string, side: ConflictSide) => void
  headerActions?: ReactNode
  loading: boolean
}

const bothRenamePaths = (rows: readonly UnifiedFileRow[]): string[] =>
  rows.flatMap((row) => (row.renameSource ? [row.renameSource, row.file] : [row.file]))

function groupAction(
  group: StatusGroup,
  stageAll: (files: string[]) => unknown,
  unstageAll: (files: string[]) => unknown
): FileListSection['action'] {
  if (group.kind === 'staged') {
    return { label: 'Unstage all', onAction: () => unstageAll(bothRenamePaths(group.rows)) }
  }
  if (group.kind === 'unstaged') {
    return { label: 'Stage all', onAction: () => stageAll(group.rows.map((row) => row.file)) }
  }
  return undefined
}

export function StatusPanel(props: StatusPanelProps) {
  const {
    status,
    rows: worktreeRows,
    statusState,
    statusLoading,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll
  } = useWorkingTreeStatus()
  const loading = props.loading || statusLoading
  const amendRows = props.amendRows ?? []
  const groups = useMemo(() => buildStatusGroups(worktreeRows), [worktreeRows])

  const sections = useMemo<FileListSection[]>(() => {
    const working = groups.map((group) => ({
      key: group.kind,
      label: group.label,
      rows: group.rows,
      action: groupAction(group, stageAll, unstageAll)
    }))
    if (amendRows.length === 0) {
      return working
    }
    return [...working, { key: 'head-commit' as const, label: 'Last commit', rows: amendRows }]
  }, [groups, amendRows, stageAll, unstageAll])

  if (!status) {
    if (statusState === 'error') {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Changes unavailable
        </div>
      )
    }
    return loading ? <StatusPanelSkeleton /> : null
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      {props.headerActions || loading ? (
        <div className="scroll-host flex shrink-0 items-center gap-2 overflow-x-auto border-b px-3 py-1.5">
          {loading ? <LoadingBadge /> : null}
          <div className="flex-1" />
          {props.headerActions}
        </div>
      ) : null}

      <VirtualFileList
        sections={sections}
        selected={props.selected}
        onSelect={props.onSelect}
        onStage={stageFile}
        onUnstage={unstageFile}
        onToggleDrop={props.onToggleDrop}
        onFileAction={props.onFileAction}
        conflictLabels={status.operation}
        onResolveConflict={props.onResolveConflict}
      />
    </section>
  )
}
