import { useEffect } from 'react'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { createMemo, createSignal, type JSX, Show } from '@/lib/react-compat'
import {
  defaultVisibleTimelineRefs,
  effectiveVisibleTimelineRefs,
  toggleVisibleTimelineRef
} from '@/lib/timeline-visible-refs'
import { CommitPanel } from './components/CommitPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { StatusPanel } from './components/StatusPanel'
import { Shell } from './components/shell/Shell'
import type { SidebarView } from './components/shell/Sidebar'
import { useCheckoutRef } from './hooks/git/useCheckoutRef'
import type { RefKind } from './lib/ref-tree'
import { repoDisplayName } from './lib/repoDisplayName'
import type { GitStore } from './stores/git'

interface WorkspaceProps {
  git: GitStore
  tabActive?: () => boolean
  modifiedCount: number
  stagedCount: number
  untrackedCount: number
  totalChanges: number
  errorBanner: JSX.Element
}

export function Workspace(props: WorkspaceProps) {
  const git = props.git
  const repoPath = git.state.repoPath
  const repoName = () => repoDisplayName(repoPath)
  const branch = () => git.state.currentBranch || 'no-branch'
  const [activeView, setActiveView] = createSignal<SidebarView>('history')
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
      repoName={repoName()}
      repoPath={repoPath}
      branch={branch()}
      localBranches={localBranches}
      remoteBranches={remoteBranches}
      tags={sidebarTags()}
      branchesLoading={git.state.branchesLoading}
      changes={props.totalChanges}
      activeView={activeView()}
      onSelectView={setActiveView}
      onFetch={git.fetchNow}
      onCheckoutRef={handleCheckoutRef}
      tracking={sidebarTracking()}
      visibleTimelineRefs={timelineFilterRefs()}
      onToggleTimelineVisibility={handleToggleTimelineVisibility}
    >
      {props.errorBanner}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
        <Show when={activeView() === 'local-changes'}>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]">
            <div className="min-h-0 overflow-hidden">
              <StatusPanel
                status={git.state.status}
                onStage={git.stageFile}
                onUnstage={git.unstageFile}
                loading={git.loading() || git.state.statusLoading}
              />
            </div>
            <div className="min-h-0 overflow-hidden">
              <CommitPanel onCommit={git.commit} loading={git.loading()} />
            </div>
          </div>
        </Show>
        <Show when={(props.tabActive?.() ?? true) && activeView() === 'history'}>
          <div className="min-h-0 flex-1 overflow-hidden">
            <HistoryPanel
              log={git.state.log}
              loading={git.state.logLoading}
              loadingMore={git.state.logLoadingMore}
              hasMore={git.state.logHasMore}
              onLoadMore={() => void git.loadMoreHistory()}
              repoPath={repoPath}
              remotes={git.state.remotes}
              currentBranch={git.state.currentBranch}
              remoteBranches={remoteBranches}
              visibleBranchRefs={timelineFilterRefs()}
            />
          </div>
        </Show>
      </div>

      <span className="sr-only">
        {props.modifiedCount} modified, {props.stagedCount} staged, {props.untrackedCount} untracked
      </span>
    </Shell>
  )
}
