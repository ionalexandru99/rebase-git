import { useEffect } from 'react'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { createMemo, createSignal, type JSX } from '@/lib/react-compat'
import {
  defaultVisibleTimelineRefs,
  effectiveVisibleTimelineRefs,
  toggleVisibleTimelineRef
} from '@/lib/timeline-visible-refs'
import { Shell } from './components/shell/Shell'
import type { WorkspaceView } from './components/shell/Topbar'
import { useCheckoutRef } from './hooks/git/useCheckoutRef'
import { formatRelativeTime } from './lib/format'
import type { RefKind } from './lib/ref-tree'
import { repoDisplayName } from './lib/repoDisplayName'
import type { GitStore } from './stores/git'
import { WorkspaceViewRenderer } from './WorkspaceViews'

interface WorkspaceProps {
  git: GitStore
  tabActive?: () => boolean
  errorBanner: JSX.Element
}

export function Workspace(props: WorkspaceProps) {
  const git = props.git
  const repoPath = git.state.repoPath
  const repoName = () => repoDisplayName(repoPath)
  const branch = () => git.state.currentBranch || 'no-branch'
  const modifiedCount = () => git.state.status?.modified.length ?? 0
  const stagedCount = () => git.state.status?.staged.length ?? 0
  const untrackedCount = () => git.state.status?.not_added.length ?? 0
  const totalChanges = createMemo(() => modifiedCount() + stagedCount() + untrackedCount())
  const [activeView, setActiveView] = createSignal<WorkspaceView>('history')
  const [visibleTimelineRefs, setVisibleTimelineRefs] = createSignal<Set<string>>(new Set())

  const sidebarLocalBranches = createMemo(() => git.state.branches?.all ?? [])
  const sidebarRemoteBranches = createMemo(() => git.state.branches?.remotes ?? [])
  const sidebarTags = createMemo(() => git.state.branches?.tags ?? [])
  const sidebarTracking = createMemo(() => git.state.branches?.tracking)
  const localBranches = sidebarLocalBranches()
  const remoteBranches = sidebarRemoteBranches()

  const timelineFilterRefs = createMemo(() =>
    effectiveVisibleTimelineRefs(
      visibleTimelineRefs(),
      localBranches,
      remoteBranches,
      git.state.defaultBranch,
      git.state.currentBranch,
      new Set(Object.keys(git.state.remotes))
    )
  )

  useEffect(() => {
    if (!repoPath) {
      setVisibleTimelineRefs(new Set<string>())
      return
    }
    setVisibleTimelineRefs(new Set<string>())
  }, [repoPath, setVisibleTimelineRefs])

  useEffect(() => {
    if (!repoPath) {
      return
    }
    if (localBranches.length === 0) {
      return
    }
    setVisibleTimelineRefs((prev) => {
      if (prev.size > 0) {
        return prev
      }
      return defaultVisibleTimelineRefs(
        localBranches,
        remoteBranches,
        git.state.defaultBranch,
        git.state.currentBranch,
        new Set(Object.keys(git.state.remotes))
      )
    })
  }, [
    repoPath,
    git.state.defaultBranch,
    git.state.currentBranch,
    git.state.remotes,
    localBranches,
    remoteBranches,
    setVisibleTimelineRefs
  ])

  const handleCheckoutRef = useCheckoutRef(
    () => repoPath,
    (repoPath) => git.refreshAfterCheckout(repoPath)
  )

  const handleToggleTimelineVisibility = (refKind: RefKind, fullPath: string) => {
    if (refKind === 'tag') {
      return
    }
    const key = refFilterKey(refKind, fullPath)
    setVisibleTimelineRefs((prev) =>
      toggleVisibleTimelineRef(
        prev,
        key,
        localBranches,
        remoteBranches,
        git.state.defaultBranch,
        git.state.currentBranch,
        new Set(Object.keys(git.state.remotes))
      )
    )
  }

  return (
    <Shell
      repo={{
        repoName: repoName(),
        repoPath,
        branch: branch(),
        changes: totalChanges()
      }}
      navigation={{
        activeView: activeView(),
        onSelectView: setActiveView
      }}
      branchBrowser={{
        localBranches,
        remoteBranches,
        tags: sidebarTags(),
        branchesLoading: git.state.branchesLoading,
        tracking: sidebarTracking(),
        visibleTimelineRefs: timelineFilterRefs(),
        onToggleTimelineVisibility: handleToggleTimelineVisibility,
        onCheckoutRef: handleCheckoutRef
      }}
      workspaceContext={
        git.state.lastFetchedAt
          ? `Fetched ${formatRelativeTime(git.state.lastFetchedAt, Date.now())}`
          : undefined
      }
      onFetch={git.fetchNow}
      onPull={git.pullNow}
      onPush={git.pushNow}
      pulling={git.state.pulling}
      pushing={git.state.pushing}
    >
      {props.errorBanner}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <WorkspaceViewRenderer
          activeView={activeView()}
          git={git}
          repoPath={repoPath}
          remoteBranches={remoteBranches}
          visibleBranchRefs={timelineFilterRefs()}
          onToggleTimelineVisibility={handleToggleTimelineVisibility}
          tabActive={() => props.tabActive?.() ?? true}
        />
      </div>

      <span className="sr-only">
        {modifiedCount()} modified, {stagedCount()} staged, {untrackedCount()} untracked
      </span>
    </Shell>
  )
}
