import { XIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { RefTreePanel } from '../features/refs/RefTreePanel'
import type { BranchBrowser } from './Shell'

interface AppSidebarProps {
  branchBrowser: BranchBrowser
  currentBranch: string
  onResizeStart?: (event: MouseEvent<HTMLSpanElement>) => void
  onClose?: () => void
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <aside
      aria-label="Branches"
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--r-sm)] border bg-card-2 shadow-[var(--shadow)]"
    >
      {props.onClose ? (
        <button
          type="button"
          aria-label="Close branches"
          onClick={props.onClose}
          className="absolute right-2 top-2 z-40 inline-flex size-7 items-center justify-center rounded-[var(--r-sm)] bg-card-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
      <RefTreePanel
        repoPath={props.branchBrowser.repoPath}
        localBranches={props.branchBrowser.localBranches}
        remoteBranches={props.branchBrowser.remoteBranches}
        tags={props.branchBrowser.tags}
        stashes={props.branchBrowser.stashes}
        currentBranch={props.currentBranch}
        loading={props.branchBrowser.branchesLoading}
        tracking={props.branchBrowser.tracking}
        visibleTimelineRefs={props.branchBrowser.visibleTimelineRefs}
        onToggleTimelineVisibility={props.branchBrowser.onToggleTimelineVisibility}
        onCheckoutRef={props.branchBrowser.onCheckoutRef}
        onBranchAction={props.branchBrowser.onBranchAction}
        onStashAction={props.branchBrowser.onStashAction}
      />

      {props.onResizeStart ? (
        <span
          onMouseDown={(event) => props.onResizeStart?.(event)}
          aria-hidden="true"
          className="group/sidebar-resize absolute -right-1 top-0 z-30 flex h-full w-2 cursor-col-resize items-stretch justify-center"
        >
          <span className="w-px bg-border-strong/50 transition-colors group-hover/sidebar-resize:bg-primary/70" />
        </span>
      ) : null}
    </aside>
  )
}
