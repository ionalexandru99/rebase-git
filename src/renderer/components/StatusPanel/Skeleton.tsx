import { For } from '@/lib/react-compat'
import { Panel, PanelHeader, PanelHeaderGroup, PanelTitle } from '../ui/panel'
import { Skeleton } from '../ui/skeleton'

export function StatusPanelSkeleton() {
  return (
    <Panel>
      <PanelHeader>
        <PanelHeaderGroup>
          <PanelTitle>Working Directory</PanelTitle>
          <Skeleton className="h-3 w-24 rounded" />
        </PanelHeaderGroup>
        <Skeleton className="h-5 w-16 rounded" />
      </PanelHeader>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <For each={['Staged', 'Changes', 'Untracked'] as const}>
          {(section) => (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section}
                </span>
                <Skeleton className="h-3 w-4 rounded" />
              </div>
              <For each={[0, 1]}>
                {(index) => (
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <Skeleton className="size-3 rounded-sm" />
                    <Skeleton
                      className="h-3 rounded"
                      style={{ width: `${55 + ((index * 19) % 30)}%` }}
                    />
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </div>
    </Panel>
  )
}
