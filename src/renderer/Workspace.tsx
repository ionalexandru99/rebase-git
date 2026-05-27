import { createEffect, createMemo, createSignal, type JSX, on, Show } from 'solid-js'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
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
  const repoName = () => repoDisplayName(git.state.repoPath)
  const branch = () => git.state.currentBranch || 'no-branch'
  const [activeView, setActiveView] = createSignal<SidebarView>('history')
  const [visibleTimelineRefs, setVisibleTimelineRefs] = createSignal<Set<string>>(new Set())

  const sidebarLocalBranches = createMemo(() => git.state.branches?.all ?? [])
  const sidebarRemoteBranches = createMemo(() => git.state.branches?.remotes ?? [])
  const sidebarTags = createMemo(() => git.state.branches?.tags ?? [])
  const sidebarTracking = createMemo(() => git.state.branches?.tracking)

  const timelineFilterRefs = createMemo(() =>
    effectiveVisibleTimelineRefs(
      visibleTimelineRefs(),
      sidebarLocalBranches(),
      sidebarRemoteBranches(),
      git.state.defaultBranch,
      git.state.currentBranch,
      new Set(Object.keys(git.state.remotes))
    )
  )

  createEffect(
    on(
      () => git.state.repoPath,
      (repoPath) => {
        if (!repoPath) {
          setVisibleTimelineRefs(new Set<string>())
          return
        }
        setVisibleTimelineRefs(new Set<string>())
      }
    )
  )

  createEffect(() => {
    if (!git.state.repoPath) {
      return
    }
    const local = sidebarLocalBranches()
    if (local.length === 0) {
      return
    }
    setVisibleTimelineRefs((prev) => {
      if (prev.size > 0) {
        return prev
      }
      return defaultVisibleTimelineRefs(
        local,
        sidebarRemoteBranches(),
        git.state.defaultBranch,
        git.state.currentBranch,
        new Set(Object.keys(git.state.remotes))
      )
    })
  })

  const handleCheckoutRef = useCheckoutRef(() => git.state.repoPath)

  const handleToggleTimelineVisibility = (refKind: RefKind, fullPath: string) => {
    if (refKind === 'tag') {
      return
    }
    const key = refFilterKey(refKind, fullPath)
    setVisibleTimelineRefs((prev) =>
      toggleVisibleTimelineRef(
        prev,
        key,
        sidebarLocalBranches(),
        sidebarRemoteBranches(),
        git.state.defaultBranch,
        git.state.currentBranch,
        new Set(Object.keys(git.state.remotes))
      )
    )
  }

  return (
    <Shell
      repoName={repoName()}
      repoPath={git.state.repoPath}
      branch={branch()}
      localBranches={sidebarLocalBranches()}
      remoteBranches={sidebarRemoteBranches()}
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
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
        <Show when={activeView() === 'local-changes'}>
          <div class="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]">
            <div class="min-h-0 overflow-hidden">
              <StatusPanel
                status={git.state.status}
                onStage={git.stageFile}
                onUnstage={git.unstageFile}
                loading={git.loading() || git.state.statusLoading}
              />
            </div>
            <div class="min-h-0 overflow-hidden">
              <CommitPanel onCommit={git.commit} loading={git.loading()} />
            </div>
          </div>
        </Show>
        <Show when={(props.tabActive?.() ?? true) && activeView() === 'history'}>
          <div class="min-h-0 flex-1 overflow-hidden">
            <HistoryPanel
              log={git.state.log}
              loading={git.state.logLoading}
              loadingMore={git.state.logLoadingMore}
              hasMore={git.state.logHasMore}
              onLoadMore={() => void git.loadMoreHistory()}
              repoPath={git.state.repoPath}
              remotes={git.state.remotes}
              currentBranch={git.state.currentBranch}
              remoteBranches={sidebarRemoteBranches()}
              visibleBranchRefs={timelineFilterRefs()}
            />
          </div>
        </Show>
      </div>

      <span class="sr-only">
        {props.modifiedCount} modified, {props.stagedCount} staged, {props.untrackedCount} untracked
      </span>
    </Shell>
  )
}
