import { RefTreePanel } from '../features/refs/RefTreePanel'
import { type BranchBrowser, COLUMN_HEADER_HEIGHT } from './Shell'

interface AppSidebarProps {
  branchBrowser: BranchBrowser
  currentBranch: string
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <aside
      aria-label="Branches"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card-2"
    >
      <div
        style={{ height: `${COLUMN_HEADER_HEIGHT}px` }}
        className="flex shrink-0 items-center border-b px-3 text-[13px] font-semibold"
      >
        Branches
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <RefTreePanel
          repoPath={props.branchBrowser.repoPath}
          localBranches={props.branchBrowser.localBranches}
          remoteBranches={props.branchBrowser.remoteBranches}
          tags={props.branchBrowser.tags}
          stashes={props.branchBrowser.stashes}
          currentBranch={props.currentBranch}
          loading={props.branchBrowser.branchesLoading}
          tracking={props.branchBrowser.tracking}
          lastCommitAt={props.branchBrowser.lastCommitAt}
          remoteLastCommitAt={props.branchBrowser.remoteLastCommitAt}
          tagLastCommitAt={props.branchBrowser.tagLastCommitAt}
          visibleTimelineRefs={props.branchBrowser.visibleTimelineRefs}
          onToggleTimelineVisibility={props.branchBrowser.onToggleTimelineVisibility}
          onCheckoutRef={props.branchBrowser.onCheckoutRef}
          onBranchAction={props.branchBrowser.onBranchAction}
          onStashAction={props.branchBrowser.onStashAction}
        />
      </div>
    </aside>
  )
}
