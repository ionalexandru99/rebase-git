import type { MouseEvent } from 'react'
import { Show } from '@/lib/react-compat'
import { RefTreePanel } from './RefTreePanel'
import type { BranchBrowser } from './Shell'

interface AppSidebarProps {
  branchBrowser: BranchBrowser
  currentBranch: string
  onResizeStart?: (event: MouseEvent<HTMLSpanElement>) => void
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <aside
      aria-label="Branches"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--r-sm)] border bg-card-2 shadow-[var(--shadow)]"
    >
      <RefTreePanel
        localBranches={props.branchBrowser.localBranches}
        remoteBranches={props.branchBrowser.remoteBranches}
        tags={props.branchBrowser.tags}
        currentBranch={props.currentBranch}
        loading={props.branchBrowser.branchesLoading}
        tracking={props.branchBrowser.tracking}
        visibleTimelineRefs={props.branchBrowser.visibleTimelineRefs}
        onToggleTimelineVisibility={props.branchBrowser.onToggleTimelineVisibility}
        onCheckoutRef={props.branchBrowser.onCheckoutRef}
        onBranchAction={props.branchBrowser.onBranchAction}
      />

      <Show when={props.onResizeStart}>
        <span
          onMouseDown={(event) => props.onResizeStart?.(event)}
          aria-hidden="true"
          className="group/sidebar-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span className="w-px bg-transparent transition-colors group-hover/sidebar-resize:bg-primary/60" />
        </span>
      </Show>
    </aside>
  )
}
