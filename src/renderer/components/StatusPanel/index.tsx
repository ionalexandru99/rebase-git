import { createMemo, Show } from '@/lib/react-compat'
import { buildUnifiedFileRows } from '@/lib/status-file-rows'
import type { GitStatus } from '@/types'
import { Checkbox } from '../ui/checkbox'
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
  loading: boolean
}

export function StatusPanel(props: StatusPanelProps) {
  return (
    <Show
      when={props.status}
      fallback={
        <Show when={props.loading}>
          <StatusPanelSkeleton />
        </Show>
      }
    >
      {(status) => {
        const rows = createMemo(() => buildUnifiedFileRows(status()))
        const stageable = createMemo(() => rows().filter((row) => !row.isConflicted))
        const stagedCount = () => stageable().filter((row) => row.stageState !== 'unstaged').length
        const allStaged = () =>
          stageable().length > 0 && stageable().every((row) => row.stageState === 'staged')
        const anyStaged = () => stageable().some((row) => row.stageState !== 'unstaged')

        const subtitle = () => `${rows().length} files · ${stagedCount()} staged`

        const toggleAll = () => {
          if (allStaged()) {
            for (const row of stageable()) {
              props.onUnstage(row.file)
            }
            return
          }
          for (const row of stageable()) {
            if (row.stageState !== 'staged') {
              props.onStage(row.file)
            }
          }
        }

        return (
          <section className="flex h-full min-h-0 flex-col overflow-hidden border-r">
            <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-3">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">Changes</div>
                <div className="truncate text-[13px] text-muted-foreground">{subtitle()}</div>
              </div>
              <div className="flex-1" />
              <Show when={props.loading}>
                <LoadingBadge />
              </Show>
              <Show when={stageable().length > 0}>
                <Checkbox
                  checked={allStaged()}
                  indeterminate={!allStaged() && anyStaged()}
                  aria-label={allStaged() ? 'Unstage all files' : 'Stage all files'}
                  onChange={toggleAll}
                />
              </Show>
            </div>

            <VirtualFileList
              status={status()}
              selected={props.selected}
              onSelect={props.onSelect}
              onStage={props.onStage}
              onUnstage={props.onUnstage}
            />
          </section>
        )
      }}
    </Show>
  )
}
