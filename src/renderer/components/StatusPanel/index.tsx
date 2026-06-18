import { type ReactNode, useMemo } from 'react'
import type { FileAction } from '@/lib/git-actions'
import { buildUnifiedFileRows } from '@/lib/status-file-rows'
import type { GitStatus } from '@/types'
import { LoadingBadge } from '../ui/loading-badge'
import { StatusPanelSkeleton } from './Skeleton'
import { type SelectedFile, VirtualFileList } from './VirtualFileList'

export type { SelectedFile } from './VirtualFileList'

interface StatusPanelProps {
  status: GitStatus | null
  selected: SelectedFile | null
  onSelect: (file: string) => void
  onStage: (file: string) => void
  onUnstage: (file: string) => void
  onStageAll: (files: string[]) => void
  onUnstageAll: (files: string[]) => void
  onFileAction?: (action: FileAction, file: string) => void
  headerActions?: ReactNode
  loading: boolean
}

export function StatusPanel(props: StatusPanelProps) {
  const rows = useMemo(
    () => (props.status ? buildUnifiedFileRows(props.status) : []),
    [props.status]
  )
  const stageable = useMemo(() => rows.filter((row) => !row.isConflicted), [rows])
  const stagedCount = stageable.filter((row) => row.stageState !== 'unstaged').length
  const allStaged = stageable.length > 0 && stageable.every((row) => row.stageState === 'staged')
  const subtitle = `${rows.length} files · ${stagedCount} staged`

  const toggleAll = () => {
    if (allStaged) {
      props.onUnstageAll(stageable.map((row) => row.file))
      return
    }
    props.onStageAll(stageable.filter((row) => row.stageState !== 'staged').map((row) => row.file))
  }

  if (!props.status) {
    return props.loading ? <StatusPanelSkeleton /> : null
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border-r">
      <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">Changes</div>
          <div className="truncate text-[13px] text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex-1" />
        {props.loading ? <LoadingBadge /> : null}
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

      <VirtualFileList
        status={props.status}
        selected={props.selected}
        onSelect={props.onSelect}
        onStage={props.onStage}
        onUnstage={props.onUnstage}
        onFileAction={props.onFileAction}
      />
    </section>
  )
}
