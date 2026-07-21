import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useLatestRef } from '@/hooks/useLatestRef'
import { formatCause } from '@/lib/format-cause'
import { cachesForRepoChange, type RepoCache } from '@/lib/operation-caches'
import { repoQueryKeys } from '@/lib/query-keys'
import {
  ActionRunnerProvider,
  useActionRunnerController,
  useRepoMutationCoordinator
} from './action-runner'
import { CommitHistoryProvider, useCommitHistoryController } from './commit-history'
import { RefsProvider, useRefsController } from './refs'
import {
  emptyRepoSessionLifecycle,
  RepoSessionContext,
  type RepoSessionLifecycle,
  RepoSessionProvider,
  useRepoSession,
  useRepoSessionController
} from './repo-session'
import { useWorkingTreeStatusController, WorkingTreeStatusProvider } from './working-tree-status'

export type { ActionRunner } from './action-runner'
export { useActionRunner } from './action-runner'
export { useCommitHistory } from './commit-history'
export { useRefs } from './refs'
export type { RepoSession } from './repo-session'
export { useFileDiff, useHeadCommit, useWorkingTreeStatus } from './working-tree-status'
export { RepoSessionProvider, useRepoSession }

function useGitStoreValue(tabId: string, tabActive: boolean) {
  const queryClient = useQueryClient()
  const sessionLifecycle = useRef<RepoSessionLifecycle>(emptyRepoSessionLifecycle)
  const session = useRepoSessionController(sessionLifecycle)

  const path = session.repoPath

  const liveRepoPath = session.liveRepoPath
  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const openGeneration = session.openGenerationRef
  const mutationCoordinator = useRepoMutationCoordinator()

  const isCurrentRepo = (generation: number, repoPath: string) =>
    generation === openGeneration.current && liveRepoPath.current === repoPath

  const workingTreeStatus = useWorkingTreeStatusController({
    repoPath: path,
    tabId,
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError,
    clearError: session.clearError,
    mutationCoordinator
  })

  const commitHistory = useCommitHistoryController({
    repoPath: path,
    tabId,
    tabActive,
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError,
    clearError: session.clearError
  })

  const refreshAfterFetch = (repoPath: string): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).localBranches }),
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).remoteRefs }),
      commitHistory.restart(repoPath)
    ])

  const refs = useRefsController({
    repoPath: path,
    tabId,
    tabActive,
    remotes: session.remotes,
    defaultBranch: session.defaultBranch,
    statusCurrent: workingTreeStatus.status?.current,
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError,
    clearError: session.clearError,
    mutationCoordinator,
    refreshAfterFetch
  })

  useEffect(() => {
    const error = workingTreeStatus.statusError
    if (error) {
      session.setError('status', formatCause(error))
      return
    }
    session.clearError('status')
  }, [workingTreeStatus.statusError, session.setError, session.clearError])

  useEffect(() => {
    const error = refs.localBranchesError ?? refs.remoteRefsError
    if (error) {
      session.setError('refs', formatCause(error))
      return
    }
    session.clearError('refs')
  }, [refs.localBranchesError, refs.remoteRefsError, session.setError, session.clearError])

  const reset = () => {
    commitHistory.reset()
  }

  const repoCacheQueryKey = (repoPath: string, cache: RepoCache): readonly unknown[] => {
    const queryKeys = repoQueryKeys(repoPath)
    switch (cache) {
      case 'status':
        return queryKeys.status
      case 'localBranches':
        return queryKeys.localBranches
      case 'remoteRefs':
        return queryKeys.remoteRefs
      case 'log':
        return queryKeys.log
      case 'stash':
        return queryKeys.stash
      case 'diff':
        return queryKeys.diffRoot
      case 'headCommit':
        return queryKeys.headCommit
    }
  }

  const refreshMappedCache = (repoPath: string, cache: RepoCache): Promise<unknown> =>
    cache === 'log'
      ? commitHistory.restart(repoPath)
      : queryClient.invalidateQueries({ queryKey: repoCacheQueryKey(repoPath, cache) })

  const refreshCaches = (repoPath: string, caches: readonly RepoCache[]): Promise<unknown> =>
    Promise.all(caches.map((cache) => refreshMappedCache(repoPath, cache)))

  sessionLifecycle.current = {
    onRepoOpened: (opened, generation) => {
      void refreshCaches(opened.path, ['status', 'localBranches', 'remoteRefs'])
      commitHistory.onRepoOpened(opened, generation)
    },
    onBeforeRepoClosed: (repoPath) => commitHistory.cancelStream(repoPath),
    onSessionReset: reset
  }

  const actionRunner = useActionRunnerController({
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    refreshCaches,
    mutationCoordinator
  })

  const latest = useLatestRef({
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    openRepo: session.openRepo
  })

  useEffect(() => {
    const unsubRestarted = window.electronAPI.onSidecarRestarted(() => {
      const { getRepoPath, openRepo, isTabActive } = latest.current
      const repoPath = getRepoPath()
      if (!repoPath) {
        return
      }
      if (isTabActive()) {
        toast.info('Reconnecting git engine…')
      }
      void openRepo(repoPath)
    })

    return () => {
      unsubRestarted?.()
    }
  }, [])

  return {
    session,
    workingTreeStatus: workingTreeStatus.value,
    commitHistory: commitHistory.value,
    refs: refs.value,
    actionRunner,
    repoChangedHandlers: { refreshCaches }
  }
}

interface GitStoreProviderProps {
  tabId: string
  tabActive: boolean
  children: ReactNode
}

export function GitStoreProvider(props: GitStoreProviderProps) {
  const { session, workingTreeStatus, commitHistory, refs, actionRunner, repoChangedHandlers } =
    useGitStoreValue(props.tabId, props.tabActive)
  const latestRepoChanged = useLatestRef({
    repoPath: session.repoPath,
    handlers: repoChangedHandlers
  })

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRepoChanged((event) => {
      const { repoPath, handlers } = latestRepoChanged.current
      if (event.repoPath !== repoPath) {
        return
      }
      void handlers.refreshCaches(event.repoPath, cachesForRepoChange(event.kind))
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <RepoSessionContext.Provider value={session.publicValue}>
      <WorkingTreeStatusProvider value={workingTreeStatus}>
        <CommitHistoryProvider value={commitHistory}>
          <RefsProvider value={refs}>
            <ActionRunnerProvider value={actionRunner}>{props.children}</ActionRunnerProvider>
          </RefsProvider>
        </CommitHistoryProvider>
      </WorkingTreeStatusProvider>
    </RepoSessionContext.Provider>
  )
}
