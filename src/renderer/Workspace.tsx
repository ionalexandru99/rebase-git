import { createEffect, createMemo, createSignal, type JSX } from 'solid-js'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
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
  modifiedCount: number
  stagedCount: number
  untrackedCount: number
  totalChanges: number
  errorBanner: JSX.Element
}

function isValidFilterRef(key: string, localBranches: string[], remoteBranches: string[]): boolean {
  const colon = key.indexOf(':')
  if (colon === -1) {
    return false
  }
  const kind = key.slice(0, colon)
  const fullPath = key.slice(colon + 1)
  if (kind === 'local') {
    return localBranches.includes(fullPath)
  }
  if (kind === 'remote') {
    return remoteBranches.includes(fullPath)
  }
  return false
}

export function Workspace(props: WorkspaceProps) {
  const git = props.git
  const repoName = () => repoDisplayName(git.state.repoPath)
  const branch = () => git.state.currentBranch || 'no-branch'
  const [activeView, setActiveView] = createSignal<SidebarView>('history')
  const [branchFilterActive, setBranchFilterActive] = createSignal(false)
  const [selectedFilterRefs, setSelectedFilterRefs] = createSignal<Set<string>>(new Set())

  const sidebarLocalBranches = createMemo(() => git.state.branches?.all ?? [])
  const sidebarRemoteBranches = createMemo(() => git.state.branches?.remotes ?? [])
  const sidebarTags = createMemo(() => git.state.branches?.tags ?? [])
  const sidebarTracking = createMemo(() => git.state.branches?.tracking)

  createEffect(() => {
    const local = sidebarLocalBranches()
    const remote = sidebarRemoteBranches()
    setSelectedFilterRefs((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const key of prev) {
        if (isValidFilterRef(key, local, remote)) {
          next.add(key)
        } else {
          changed = true
        }
      }
      if (!changed && next.size === prev.size) {
        return prev
      }
      return next
    })
  })

  const handleCheckoutRef = useCheckoutRef(() => git.state.repoPath)

  const handleToggleBranchFilter = () => {
    setBranchFilterActive((active) => !active)
  }

  const handleToggleFilterRef = (refKind: RefKind, fullPath: string) => {
    if (refKind === 'tag') {
      return
    }
    const key = refFilterKey(refKind, fullPath)
    setSelectedFilterRefs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
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
      branchFilterActive={branchFilterActive()}
      selectedFilterRefs={selectedFilterRefs()}
      onToggleBranchFilter={handleToggleBranchFilter}
      onToggleFilterRef={handleToggleFilterRef}
    >
      {props.errorBanner}
      <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-2.5">
        <div
          hidden={activeView() !== 'local-changes'}
          class="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-hidden xl:grid-cols-[minmax(21rem,0.85fr)_minmax(0,1.15fr)]"
        >
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
        <div hidden={activeView() !== 'history'} class="min-h-0 flex-1 overflow-hidden">
          <HistoryPanel
            log={git.state.log}
            loading={git.state.logLoading}
            remotes={git.state.remotes}
            currentBranch={git.state.currentBranch}
            remoteBranches={sidebarRemoteBranches()}
            branchFilterActive={branchFilterActive()}
            selectedBranchRefs={selectedFilterRefs()}
          />
        </div>
      </div>

      <span class="sr-only">
        {props.modifiedCount} modified, {props.stagedCount} staged, {props.untrackedCount} untracked
      </span>
    </Shell>
  )
}
