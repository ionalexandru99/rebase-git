import { useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import { useDialogs } from '@/components/ui/prompt-dialog'
import {
  type BranchAction,
  type CommitAction,
  RESET_MODE_BY_ACTION,
  type StashAction
} from '@/lib/git-actions'
import { createSignal, type JSX } from '@/lib/react-compat'
import {
  defaultVisibleTimelineRefs,
  effectiveVisibleTimelineRefs,
  toggleVisibleTimelineRef
} from '@/lib/timeline-visible-refs'
import { Shell } from './components/shell/Shell'
import type { WorkspaceView } from './components/shell/Topbar'
import { useCheckoutRef } from './hooks/git/useCheckoutRef'
import { useGitActions } from './hooks/git/useGitActions'
import { useStashes } from './hooks/git/useStashes'
import { formatRelativeTime } from './lib/format'
import type { RefKind } from './lib/ref-tree'
import { repoDisplayName } from './lib/repoDisplayName'
import type { GitStore } from './stores/git'
import { WorkspaceViewRenderer } from './WorkspaceViews'

function shortRefName(refKind: RefKind, fullPath: string): string {
  if (refKind === 'remote') {
    const slash = fullPath.indexOf('/')
    return slash >= 0 ? fullPath.slice(slash + 1) : fullPath
  }
  return fullPath
}

async function copyToClipboard(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(label)
  } catch (error) {
    toast.error('Copy failed', {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

interface WorkspaceProps {
  git: GitStore
  tabActive?: () => boolean
  errorBanner: JSX.Element
}

const EMPTY_BRANCH_NAMES: string[] = []

export function Workspace(props: WorkspaceProps) {
  const git = props.git
  const repoPath = git.state.repoPath
  const repoName = () => repoDisplayName(repoPath)
  const branch = () => git.state.currentBranch || 'no-branch'
  const modifiedCount = () => git.state.status?.modified.length ?? 0
  const stagedCount = () => git.state.status?.staged.length ?? 0
  const untrackedCount = () => git.state.status?.not_added.length ?? 0
  const totalChanges = () => modifiedCount() + stagedCount() + untrackedCount()
  const [activeView, setActiveView] = createSignal<WorkspaceView>('history')
  const [visibleTimelineRefs, setVisibleTimelineRefs] = createSignal<Set<string>>(new Set())

  const sidebarTags = () => git.state.branches?.tags ?? EMPTY_BRANCH_NAMES
  const sidebarTracking = () => git.state.branches?.tracking
  const localBranches = git.state.branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = git.state.branches?.remotes ?? EMPTY_BRANCH_NAMES

  const selectedTimelineRefs = visibleTimelineRefs()
  const { defaultBranch, currentBranch, remotes } = git.state
  const timelineFilterRefs = useMemo(
    () =>
      effectiveVisibleTimelineRefs(
        selectedTimelineRefs,
        localBranches,
        remoteBranches,
        defaultBranch,
        currentBranch,
        new Set(Object.keys(remotes))
      ),
    [selectedTimelineRefs, localBranches, remoteBranches, defaultBranch, currentBranch, remotes]
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

  const actions = useGitActions(git)
  const stashList = useStashes(repoPath)
  const { prompt, confirm, dialogs } = useDialogs()

  const handleStashAction = (action: StashAction, index: number) => {
    switch (action) {
      case 'apply':
        void actions.stashApply(index).then(stashList.refetch)
        return
      case 'pop':
        void actions.stashPop(index).then(stashList.refetch)
        return
      case 'drop':
        confirm({
          title: `Drop stash@{${index}}?`,
          message: 'The stashed changes are permanently discarded.',
          confirmText: 'Drop',
          destructive: true,
          onConfirm: () => void actions.stashDrop(index).then(stashList.refetch)
        })
        return
    }
  }

  const handleBranchAction = (action: BranchAction, refKind: RefKind, fullPath: string) => {
    const shortName = shortRefName(refKind, fullPath)
    switch (action) {
      case 'merge':
        void actions.mergeBranch(fullPath)
        return
      case 'rename':
        prompt({
          title: `Rename ${fullPath}`,
          label: 'New branch name',
          initialValue: fullPath,
          confirmText: 'Rename',
          onConfirm: (name) => void actions.renameBranch(fullPath, name)
        })
        return
      case 'delete':
        confirm({
          title: `Delete branch ${fullPath}?`,
          message: 'This removes the local branch. Unmerged commits may be lost.',
          confirmText: 'Delete',
          destructive: true,
          onConfirm: () => void actions.deleteBranch(fullPath)
        })
        return
      case 'delete-tag':
        confirm({
          title: `Delete tag ${fullPath}?`,
          confirmText: 'Delete',
          destructive: true,
          onConfirm: () => void actions.deleteTag(fullPath)
        })
        return
      case 'new-branch':
        prompt({
          title: `New branch from ${fullPath}`,
          label: 'Branch name',
          initialValue: refKind === 'remote' ? shortName : '',
          confirmText: 'Create',
          onConfirm: (name) => void actions.createBranch(name, fullPath, true)
        })
        return
      case 'create-tag':
        prompt({
          title: `Create tag at ${fullPath}`,
          label: 'Tag name',
          confirmText: 'Create',
          onConfirm: (name) => void actions.createTag(name, fullPath)
        })
        return
      case 'copy-name':
        void copyToClipboard(fullPath, `Copied ${fullPath}`)
        return
    }
  }

  const handleCommitAction = (action: CommitAction, sha: string, message: string) => {
    switch (action) {
      case 'branch-here':
        prompt({
          title: `New branch at ${sha.slice(0, 7)}`,
          label: 'Branch name',
          confirmText: 'Create',
          onConfirm: (name) => void actions.createBranch(name, sha, true)
        })
        return
      case 'tag-here':
        prompt({
          title: `Create tag at ${sha.slice(0, 7)}`,
          label: 'Tag name',
          confirmText: 'Create',
          onConfirm: (name) => void actions.createTag(name, sha)
        })
        return
      case 'reset-soft':
      case 'reset-mixed':
        void actions.resetToCommit(sha, RESET_MODE_BY_ACTION[action])
        return
      case 'reset-hard':
        confirm({
          title: `Reset ${git.state.currentBranch || 'branch'} to ${sha.slice(0, 7)}?`,
          message: 'A hard reset discards all uncommitted changes in the working tree.',
          confirmText: 'Reset --hard',
          destructive: true,
          onConfirm: () => void actions.resetToCommit(sha, 'hard')
        })
        return
      case 'revert':
        void actions.revertCommit(sha)
        return
      case 'cherry-pick':
        void actions.cherryPick(sha)
        return
      case 'copy-sha':
        void copyToClipboard(sha, 'Copied commit SHA')
        return
      case 'copy-message':
        void copyToClipboard(message, 'Copied commit message')
        return
    }
  }

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
        stashes: stashList.stashes(),
        branchesLoading: git.state.branchesLoading,
        tracking: sidebarTracking(),
        visibleTimelineRefs: timelineFilterRefs,
        onToggleTimelineVisibility: handleToggleTimelineVisibility,
        onCheckoutRef: handleCheckoutRef,
        onBranchAction: handleBranchAction,
        onStashAction: handleStashAction
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
          visibleBranchRefs={timelineFilterRefs}
          onToggleTimelineVisibility={handleToggleTimelineVisibility}
          onCommitAction={handleCommitAction}
          tabActive={() => props.tabActive?.() ?? true}
        />
      </div>

      <span className="sr-only">
        {modifiedCount()} modified, {stagedCount()} staged, {untrackedCount()} untracked
      </span>
      {dialogs()}
    </Shell>
  )
}
