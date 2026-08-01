import { useMemo } from 'react'
import { useWorkingTreeStatus } from '@/stores/git'
import { buildStatusGroups } from './status-groups'

export function WorkingCopyHeader() {
  const { rows, stageAll } = useWorkingTreeStatus()
  const groups = useMemo(() => buildStatusGroups(rows), [rows])
  const stageableFiles = useMemo(
    () => groups.find((group) => group.kind === 'unstaged')?.rows.map((row) => row.file) ?? [],
    [groups]
  )
  const stagedCount = rows.filter(
    (row) => !row.isConflicted && row.stageState !== 'unstaged'
  ).length
  const subtitle = `${rows.length} file${rows.length === 1 ? '' : 's'} · ${stagedCount} staged`

  return (
    <div
      data-testid="working-copy-header"
      className="flex h-full min-w-0 items-center gap-3 px-3 text-[13px]"
    >
      <span className="shrink-0 font-semibold">Working copy</span>
      <span className="min-w-0 truncate text-muted-foreground">{subtitle}</span>
      <div className="flex-1" />
      <button
        type="button"
        disabled={stageableFiles.length === 0}
        onClick={() => void stageAll(stageableFiles)}
        className="h-6 shrink-0 rounded-[var(--r-sm)] border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-50 disabled:hover:border-border disabled:hover:text-muted-foreground"
      >
        Stage all
      </button>
    </div>
  )
}
