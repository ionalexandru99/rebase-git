import { type ReactNode, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDialogs } from '@/components/ui/prompt-dialog'
import { useTimelineVisibility } from '@/features/history/hooks/useTimelineVisibility'
import { useStableCallback } from '@/hooks/useStableCallback'
import {
  type BranchAction,
  type CommitAction,
  RESET_MODE_BY_ACTION,
  type StashAction
} from '@/lib/git-actions'
import { type RefKind, shortRefName } from '../features/refs/ref-tree'
import { repoDisplayName } from '../features/repos/repo-display-name'
import { useCheckoutRef } from '../hooks/git/useCheckoutRef'
import { useGitActions } from '../hooks/git/useGitActions'
import { useStashes } from '../hooks/git/useStashes'
import { Shell } from '../shell/Shell'
import type { WorkspaceView } from '../shell/Topbar'
import { useActionRunner, useRefs, useRepoSession, useWorkingTreeStatus } from '../stores/git'
import { WorkspaceProvider } from './WorkspaceContext'
import { WorkspaceViewRenderer } from './WorkspaceViews'

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
  tabActive?: boolean
  errorBanner: ReactNode
}

const EMPTY_BRANCH_NAMES: string[] = []

export function Workspace(props: WorkspaceProps) {
  const refs = useRefs()
  const actionRunner = useActionRunner()
  const { rows } = useWorkingTreeStatus()
  const { repoPath } = useRepoSession()
  const repoName = repoDisplayName(repoPath)
  const branch = refs.currentBranch || 'no-branch'
  const stagedCount = rows.filter((row) => row.stageState !== 'unstaged').length
  const totalChanges = rows.length
  const [activeView, setActiveView] = useState<WorkspaceView>('history')

  const sidebarTags = refs.branches?.tags ?? EMPTY_BRANCH_NAMES
  const sidebarTracking = refs.branches?.tracking
  const currentTracking = refs.currentBranch ? sidebarTracking?.[refs.currentBranch] : undefined
  const localBranches = refs.branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = refs.branches?.remotes ?? EMPTY_BRANCH_NAMES

  const timeline = useTimelineVisibility(activeView === 'history' && (props.tabActive ?? true))

  const handleCheckoutRef = useCheckoutRef(actionRunner)

  const actions = useGitActions(actionRunner)
  const stashList = useStashes(repoPath)
  const { prompt, confirm, dialogs } = useDialogs()

  const handleStashAction = (action: StashAction, index: number, expectedOid: string) => {
    switch (action) {
      case 'apply':
        void actions.stashApply(index, expectedOid)
        return
      case 'pop':
        void actions.stashPop(index, expectedOid)
        return
      case 'drop':
        confirm({
          title: `Drop stash@{${index}}?`,
          message: 'The stashed changes are permanently discarded.',
          confirmText: 'Drop',
          destructive: true,
          onConfirm: () => void actions.stashDrop(index, expectedOid)
        })
        return
    }
  }

  const workspaceContextValue = useMemo(
    () => ({ actions, stashList, prompt, confirm }),
    [actions, stashList, prompt, confirm]
  )

  const handleBranchAction = (action: BranchAction, refKind: RefKind, fullPath: string) => {
    if (refKind === 'stash') {
      return
    }
    const shortName = shortRefName(refKind, fullPath)
    switch (action) {
      case 'merge':
        void actions.mergeBranch(refKind, fullPath)
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
          onConfirm: (name) => void actions.createBranch(name, fullPath, true, refKind)
        })
        return
      case 'create-tag':
        prompt({
          title: `Create tag at ${fullPath}`,
          label: 'Tag name',
          confirmText: 'Create',
          onConfirm: (name) => void actions.createTag(name, fullPath, undefined, refKind)
        })
        return
      case 'copy-name':
        void copyToClipboard(fullPath, `Copied ${fullPath}`)
        return
    }
  }

  const handleCommitAction = useStableCallback(
    (action: CommitAction, sha: string, message: string) => {
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
            title: `Reset ${refs.currentBranch || 'branch'} to ${sha.slice(0, 7)}?`,
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
  )

  return (
    <Shell
      repo={{
        repoName,
        repoPath,
        branch,
        changes: totalChanges
      }}
      navigation={{
        activeView,
        onSelectView: setActiveView
      }}
      branchBrowser={{
        repoPath,
        localBranches,
        remoteBranches,
        tags: sidebarTags,
        stashes: stashList.stashes,
        branchesLoading: refs.branchesLoading,
        tracking: sidebarTracking,
        visibleTimelineRefs: timeline.visibleRefs,
        onToggleTimelineVisibility: timeline.toggle,
        onCheckoutRef: handleCheckoutRef,
        onBranchAction: handleBranchAction,
        onStashAction: handleStashAction
      }}
      lastFetchedAt={refs.lastFetchedAt}
      onFetch={refs.fetchNow}
      onPull={actionRunner.pullNow}
      push={actionRunner.push}
      ahead={currentTracking?.ahead ?? 0}
      behind={currentTracking?.behind ?? 0}
      detached={!refs.currentBranch}
      pulling={actionRunner.pulling}
      pushing={actionRunner.pushing}
      busy={actionRunner.busy}
    >
      {props.errorBanner}
      <WorkspaceProvider value={workspaceContextValue}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <WorkspaceViewRenderer
            activeView={activeView}
            repoPath={repoPath}
            remotes={refs.remotes}
            currentBranch={refs.currentBranch}
            remoteBranches={remoteBranches}
            visibleBranchRefs={timeline.visibleRefs}
            graphCommits={timeline.graphCommits}
            timelineTips={timeline.timelineTips}
            filteredCommits={timeline.filteredCommits}
            displayedCommitSet={timeline.displayedCommitSet}
            expandedMerges={timeline.expandedMerges}
            filter={timeline.filter}
            onFilterChange={timeline.setFilter}
            visibleSet={timeline.visibleSet}
            onToggleMergeExpansion={timeline.toggleMergeExpansion}
            onToggleTimelineVisibility={timeline.toggle}
            onCommitAction={handleCommitAction}
            tabActive={props.tabActive ?? true}
          />
        </div>
      </WorkspaceProvider>

      <span className="sr-only">
        {totalChanges} changed files, {stagedCount} staged
      </span>
      {dialogs}
    </Shell>
  )
}
