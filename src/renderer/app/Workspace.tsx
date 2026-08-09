import { type ReactNode, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useDialogs } from '@/components/ui/prompt-dialog'
import { useTimelineVisibility } from '@/features/history/hooks/useTimelineVisibility'
import {
  countVisibleBranchRefs,
  getCommitIndex,
  getRefTipIndex
} from '@/features/history/selectors'
import { usePullFlow } from '@/features/sync/PullFlow'
import { useStableCallback } from '@/hooks/useStableCallback'
import {
  type BranchAction,
  type CommitAction,
  RESET_MODE_BY_ACTION,
  type StashAction
} from '@/lib/git-actions'
import { LAYOUT_RESET_EVENT } from '@/lib/layout'
import type { PullStrategy } from '@/lib/rpc-client'
import { type RefKind, shortRefName } from '../features/refs/ref-tree'
import { useCheckoutRef } from '../hooks/git/useCheckoutRef'
import { useGitActions } from '../hooks/git/useGitActions'
import { useStashes } from '../hooks/git/useStashes'
import { repoDisplayName } from '../lib/repo-display-name'
import {
  useActionRunner,
  useCommitHistory,
  useRefs,
  useRepoSession,
  useWorkingTreeStatus
} from '../stores/git'
import { useDetailSelection } from '../stores/selection'
import { WorkspaceProvider } from './WorkspaceContext'
import { WorkspaceView } from './WorkspaceView'

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
const NO_SHAS: readonly string[] = []

export function Workspace(props: WorkspaceProps) {
  const tabActive = props.tabActive ?? true
  const refs = useRefs()
  const actionRunner = useActionRunner()
  const { status, rows } = useWorkingTreeStatus()
  const { repoRef, repoPath } = useRepoSession()
  const repoName = repoDisplayName(repoPath)
  const branch = refs.currentBranch || 'no-branch'
  const stagedCount = rows.filter((row) => row.stageState !== 'unstaged').length
  const totalChanges = rows.length
  const selection = useDetailSelection()
  const history = useCommitHistory()

  const sidebarTags = refs.branches?.tags ?? EMPTY_BRANCH_NAMES
  const sidebarTracking = refs.branches?.tracking
  const currentTracking = refs.currentBranch ? sidebarTracking?.[refs.currentBranch] : undefined
  const ahead = currentTracking?.ahead ?? 0
  const behind = currentTracking?.behind ?? 0
  const localBranches = refs.branches?.all ?? EMPTY_BRANCH_NAMES
  const remoteBranches = refs.branches?.remotes ?? EMPTY_BRANCH_NAMES

  const timeline = useTimelineVisibility(tabActive)

  const remoteNames = useMemo(() => new Set(Object.keys(refs.remotes)), [refs.remotes])
  const commitsByHash = useMemo(
    () => getCommitIndex(timeline.graphCommits).byHash,
    [timeline.graphCommits]
  )
  const orderedShas = useMemo(
    () => timeline.filteredCommits.map((commit) => commit.hash),
    [timeline.filteredCommits]
  )
  const headSha = useMemo(
    () => getRefTipIndex(timeline.graphCommits, remoteNames).headTip,
    [timeline.graphCommits, remoteNames]
  )
  const visibleBranchCount = useMemo(
    () => countVisibleBranchRefs(timeline.visibleRefs, remoteBranches, remoteNames),
    [timeline.visibleRefs, remoteBranches, remoteNames]
  )

  const pruneToCommits = selection.pruneToCommits
  useEffect(() => {
    const loadedCommits = history.log?.all
    const timelineSnapshotPending =
      history.logLoading || (loadedCommits !== undefined && timeline.graphCommits !== loadedCommits)
    if (!tabActive || timelineSnapshotPending) {
      return
    }
    pruneToCommits(orderedShas)
  }, [
    history.log,
    history.logLoading,
    orderedShas,
    pruneToCommits,
    tabActive,
    timeline.graphCommits
  ])

  const selectCommitInTimeline = useStableCallback(
    (sha: string, modifiers: { toggle: boolean; range: boolean }) => {
      selection.selectCommitAt(sha, modifiers, orderedShas)
    }
  )

  const handleCheckoutRef = useCheckoutRef(actionRunner)

  const actions = useGitActions(actionRunner)
  const stashList = useStashes(repoRef)
  const { prompt, confirm, dialogs } = useDialogs()

  const pullFlow = usePullFlow({
    pull: actionRunner.pull,
    loadRememberedStrategy: () => window.electronAPI.getPullDivergedStrategy(),
    rememberStrategy: (strategy: PullStrategy) =>
      void window.electronAPI.setPullDivergedStrategy(strategy)
  })

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
      case 'rebase':
        void actions.rebaseOnto(refKind, fullPath, refs.currentBranch)
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

  const detailShas =
    selection.selection?.kind === 'commits'
      ? selection.selection.shas
      : selection.selection === null && headSha !== undefined
        ? [headSha]
        : NO_SHAS

  return (
    <WorkspaceProvider value={workspaceContextValue}>
      <WorkspaceView
        repoPath={repoPath}
        currentBranch={branch}
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
        banner={props.errorBanner}
        historyPanel={{
          log: history.log,
          loading: history.logLoading,
          loadingMore: history.logLoadingMore,
          hasMore: history.logHasMore,
          onLoadMore: () => void history.loadMoreHistory(),
          repoPath,
          repository: repoRef,
          remotes: refs.remotes,
          currentBranch: refs.currentBranch,
          graphCommits: timeline.graphCommits,
          timelineTips: timeline.timelineTips,
          filteredCommits: timeline.filteredCommits,
          displayedCommitSet: timeline.displayedCommitSet,
          expandedMerges: timeline.expandedMerges,
          visibleSet: timeline.visibleSet,
          onToggleMergeExpansion: timeline.toggleMergeExpansion,
          onCommitAction: handleCommitAction,
          selectedShas: selection.selectedShas,
          onSelectCommit: selectCommitInTimeline,
          onSelectWorkingCopy: selection.selectWorkingCopy,
          workingCopySelected: selection.workingCopySelected
        }}
        workingCopySelected={selection.selection?.kind === 'working-copy'}
        workingCopyBranch={refs.currentBranch}
        commitDetailPane={{
          shas: detailShas,
          commitsByHash,
          remotes: refs.remotes,
          remoteNames,
          onCommitAction: handleCommitAction
        }}
        listColumnHeader={{
          repoName,
          loadedCount: history.log?.all.length ?? 0,
          visibleTotal: timeline.filteredCommits.length,
          visibleBranchCount,
          hasMore: history.logHasMore,
          loading: history.logLoading || history.logLoadingMore,
          filter: timeline.filter,
          onFilterChange: timeline.setFilter,
          branchName: branch,
          ahead,
          behind,
          detached: !refs.currentBranch,
          syncing: actionRunner.pulling || actionRunner.pushing,
          busy: actionRunner.busy,
          onFetch: refs.fetchNow,
          onPull: () => pullFlow.requestPull(),
          push: actionRunner.push,
          onResetLayout: () => window.dispatchEvent(new Event(LAYOUT_RESET_EVENT)),
          onCopyRepoPath: () => {
            if (repoPath) {
              void copyToClipboard(repoPath, 'Copied repo path')
            }
          }
        }}
        statusDock={{
          branch: refs.currentBranch || null,
          ahead,
          behind,
          status,
          lastFetchedAt: refs.lastFetchedAt
        }}
        totalChanges={totalChanges}
        stagedCount={stagedCount}
        dialogs={dialogs}
        pullDialog={pullFlow.divergedDialog}
      />
    </WorkspaceProvider>
  )
}
