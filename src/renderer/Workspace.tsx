import { useMemo, useState } from 'react'
import { CommitPanel } from '@/components/CommitPanel'
import { HistoryPanel } from '@/components/HistoryPanel'
import { StatusPanel } from '@/components/StatusPanel'
import { Shell } from '@/components/shell/Shell'
import type { SidebarView } from '@/components/shell/Sidebar'
import { useCheckoutRef } from '@/hooks/git/useCheckoutRef'
import type { useGit } from '@/hooks/useGit'

interface WorkspaceProps {
  git: ReturnType<typeof useGit>
  modifiedCount: number
  stagedCount: number
  untrackedCount: number
  totalChanges: number
  errorBanner: React.ReactNode
}

export function Workspace({
  git,
  modifiedCount,
  stagedCount,
  untrackedCount,
  totalChanges,
  errorBanner
}: WorkspaceProps) {
  const repoName = git.repoPath?.split('/').filter(Boolean).at(-1) ?? 'Repository'
  const branch = git.currentBranch || 'no-branch'
  const [activeView, setActiveView] = useState<SidebarView>('history')

  const sidebarLocalBranches = useMemo(() => git.branches?.all ?? [], [git.branches])
  const sidebarRemoteBranches = useMemo(() => git.branches?.remotes ?? [], [git.branches])
  const sidebarTags = useMemo(() => git.branches?.tags ?? [], [git.branches])
  const sidebarTracking = useMemo(() => git.branches?.tracking, [git.branches])

  const handleCheckoutRef = useCheckoutRef(git.repoPath)

  return (
    <Shell
      repoName={repoName}
      repoPath={git.repoPath}
      branch={branch}
      localBranches={sidebarLocalBranches}
      remoteBranches={sidebarRemoteBranches}
      tags={sidebarTags}
      branchesLoading={git.branchesLoading}
      changes={totalChanges}
      activeView={activeView}
      onSelectView={setActiveView}
      onFetch={git.fetchNow}
      onCheckoutRef={handleCheckoutRef}
      tracking={sidebarTracking}
    >
      {errorBanner}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
        <div
          hidden={activeView !== 'local-changes'}
          className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]"
        >
          <div className="min-h-0 overflow-hidden">
            <StatusPanel
              status={git.status}
              onStage={git.stageFile}
              onUnstage={git.unstageFile}
              loading={git.loading || git.statusLoading}
            />
          </div>
          <div className="min-h-0 overflow-hidden">
            <CommitPanel onCommit={git.commit} loading={git.loading} />
          </div>
        </div>
        <div hidden={activeView !== 'history'} className="min-h-0 flex-1 overflow-hidden">
          <HistoryPanel
            log={git.log}
            loading={git.logLoading}
            remotes={git.remotes}
            currentBranch={git.currentBranch}
          />
        </div>
      </div>

      <span className="sr-only">
        {modifiedCount} modified, {stagedCount} staged, {untrackedCount} untracked
      </span>
    </Shell>
  )
}
