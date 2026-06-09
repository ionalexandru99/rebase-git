import { Show } from '@/lib/react-compat'
import type { GitStatus } from '@/types'
import { LoadingBadge } from '../ui/loading-badge'
import { StatusPanelSkeleton } from './Skeleton'
import { type SelectedFile, VirtualFileList } from './VirtualFileList'

export type { SelectedFile } from './VirtualFileList'

interface StatusPanelProps {
  status: GitStatus | null
  selected: SelectedFile | null
  onSelect: (file: string, staged: boolean) => void
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
        const totalChanges = () =>
          status().modified.length +
          status().staged.length +
          status().not_added.length +
          status().conflicted.length +
          status().deleted.length +
          status().created.length +
          status().renamed.length
        const stagedCount = () => status().staged.length + status().created.length
        const unstagedFiles = () => [
          ...status().conflicted,
          ...status().modified,
          ...status().deleted,
          ...status().not_added
        ]

        const subtitle = () => `${totalChanges()} files · ${stagedCount()} staged`

        return (
          <section className="flex h-full min-h-0 flex-col overflow-hidden border-r">
            <div className="flex min-h-[46px] shrink-0 items-center gap-2.5 border-b py-1.5 pl-3.5 pr-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold">Changes</div>
                <div className="truncate text-[13px] text-muted-foreground">{subtitle()}</div>
              </div>
              <div className="flex-1" />
              <Show when={props.loading}>
                <LoadingBadge />
              </Show>
              <Show when={unstagedFiles().length > 0}>
                <button
                  type="button"
                  onClick={() => {
                    for (const file of unstagedFiles()) {
                      props.onStage(file)
                    }
                  }}
                  className="h-7 shrink-0 rounded-[var(--r-sm)] border bg-card-2 px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                >
                  Stage all
                </button>
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
