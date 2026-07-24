import { AlertTriangleIcon } from 'lucide-react'
import { type ReactNode, useMemo } from 'react'
import type { FileAction } from '@/lib/git-actions'
import type { FileRowSource, UnifiedFileRow } from '@/lib/status-file-rows'
import { useWorkingTreeStatus } from '@/stores/git'
import { LoadingBadge } from '../ui/loading-badge'
import { StatusPanelSkeleton } from './Skeleton'
import { type SelectedFile, VirtualFileList } from './VirtualFileList'

export type { SelectedFile } from './VirtualFileList'

interface StatusPanelProps {
  selected: SelectedFile | null
  onSelect: (file: string, source: FileRowSource, renameSource?: string) => void
  onToggleDrop?: (file: string) => void
  amendRows?: UnifiedFileRow[]
  onFileAction?: (action: FileAction, file: string, renameSource?: string) => void
  headerActions?: ReactNode
  loading: boolean
}

function bySourceWithinFile(left: UnifiedFileRow, right: UnifiedFileRow): number {
  const byName = left.file.localeCompare(right.file)
  if (byName !== 0) {
    return byName
  }
  if (left.source === right.source) {
    return 0
  }
  return left.source === 'worktree' ? -1 : 1
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
  const rows = useMemo(() => {
    return [...worktreeRows, ...(props.amendRows ?? [])].sort(bySourceWithinFile)
  }, [worktreeRows, props.amendRows])
  const stageable = useMemo(
    () => rows.filter((row) => row.source === 'worktree' && !row.isConflicted),
    [rows]
  )
  const stagedCount = stageable.filter((row) => row.stageState !== 'unstaged').length
  const allStaged = stageable.length > 0 && stageable.every((row) => row.stageState === 'staged')
  const subtitle = `${rows.length} files · ${stagedCount} staged`
  const conflictCount = status?.conflicted.length ?? 0
  const showSources = (props.amendRows?.length ?? 0) > 0
  const sections = useMemo(() => {
    if (!showSources) {
      return undefined
    }
    return [
      {
        label: 'Working tree',
        rows: [...worktreeRows].sort((left, right) => left.file.localeCompare(right.file))
      },
      {
        label: 'Last commit',
        rows: [...(props.amendRows ?? [])].sort((left, right) =>
          left.file.localeCompare(right.file)
        )
      }
    ]
  }, [props.amendRows, showSources, worktreeRows])

  const toggleAll = () => {
    if (allStaged) {
      void unstageAll(
        stageable.flatMap((row) => (row.renameSource ? [row.renameSource, row.file] : [row.file]))
      )
      return
    }
    void stageAll(stageable.filter((row) => row.stageState !== 'staged').map((row) => row.file))
  }

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
      <div className="shrink-0 border-b">
        <div className="flex min-h-[46px] items-center gap-2.5 py-1.5 pl-3.5 pr-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold">Changes</div>
            <div className="truncate text-[13px] text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex-1" />
          {loading ? <LoadingBadge /> : null}
        </div>
        {props.headerActions || stageable.length > 0 ? (
          <div className="scroll-host flex items-center justify-end gap-2 overflow-x-auto px-3 pb-2">
            {props.headerActions}
            {stageable.length > 0 ? (
              <button
                type="button"
                onClick={toggleAll}
                className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {allStaged ? 'Unstage all' : 'Stage all'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {conflictCount > 0 ? (
        <div
          role="status"
          className="m-2 mb-0 flex shrink-0 items-start gap-2 rounded-[var(--r-sm)] border border-orange/40 bg-orange/10 px-3 py-2 text-sm"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-orange" />
          <div>
            <div className="font-semibold">
              {conflictCount} merge conflict{conflictCount === 1 ? '' : 's'}
            </div>
            <div className="text-xs text-muted-foreground">
              Resolve the file, then stage it to continue.
            </div>
          </div>
        </div>
      ) : null}

      <VirtualFileList
        rows={rows}
        sections={sections}
        selected={props.selected}
        onSelect={props.onSelect}
        onStage={stageFile}
        onUnstage={unstageFile}
        onToggleDrop={props.onToggleDrop}
        onFileAction={props.onFileAction}
        showSources={showSources}
      />
    </section>
  )
}
