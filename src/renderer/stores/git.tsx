import type { RepoRef } from '@common/features/repository-identity'
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { toast } from 'sonner'
import {
  type RepositoryIdentity,
  repoQueryKeys,
  repositoryIdentityKey,
  toRepoRef
} from '@/features/repository-identity'
import { useLatestRef } from '@/hooks/useLatestRef'
import { formatCause } from '@/lib/format-cause'
import { gitFailureBannerText } from '@/lib/git-report'
import { cachesForRepoChange, type RepoCache } from '@/lib/operation-caches'
import { CommitHistoryProvider, useCommitHistoryController } from '../features/history/store'
import { RefsProvider, useRefsController } from '../features/refs/store'
import { useWorkingTreeStatusController, WorkingTreeStatusProvider } from '../features/status/store'
import {
  ActionRunnerProvider,
  useActionRunnerController,
  useRepoMutationCoordinator
} from './action-runner'
import {
  emptyRepoSessionLifecycle,
  RepoSessionContext,
  type RepoSessionLifecycle,
  RepoSessionProvider,
  useRepoSession,
  useRepoSessionController
} from './repo-session'
import { DetailSelectionProvider } from './selection'

export { useCommitHistory } from '../features/history/store'
export { useRefs } from '../features/refs/store'
export {
  useCommitFileDiff,
  useFileDiff,
  useHeadCommit,
  useWorkingTreeStatus
} from '../features/status/store'
export type { ActionRunner } from './action-runner'
export { useActionRunner } from './action-runner'
export type { RepoSession } from './repo-session'
export { RepoSessionProvider, useRepoSession }

function useGitStoreValue(tabId: string, tabActive: boolean) {
  const queryClient = useQueryClient()
  const sessionLifecycle = useRef<RepoSessionLifecycle>(emptyRepoSessionLifecycle)
  const session = useRepoSessionController(sessionLifecycle)

  const repository = session.repoRef
  const path = repository?.path ?? null

  const liveRepoRef = session.liveRepoRef
  const liveRepoPath = session.liveRepoPath
  const tabActiveRef = useRef(tabActive)
  useLayoutEffect(() => {
    tabActiveRef.current = tabActive
  }, [tabActive])

  const openGeneration = session.openGenerationRef
  const mutationCoordinator = useRepoMutationCoordinator()

  const repositoryForPath = (repoPath: string): RepoRef => {
    const current = liveRepoRef.current
    return current?.path === repoPath ? current : toRepoRef(repoPath)
  }

  const isCurrentRepo = (generation: number, candidate: RepositoryIdentity) => {
    const current = liveRepoRef.current
    return (
      generation === openGeneration.current &&
      current !== null &&
      repositoryIdentityKey(current) === repositoryIdentityKey(candidate)
    )
  }

  const workingTreeStatus = useWorkingTreeStatusController({
    repoPath: path,
    repository,
    tabId,
    liveRepoRef,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError,
    clearError: session.clearError,
    mutationCoordinator
  })

  const commitHistory = useCommitHistoryController({
    repository,
    tabId,
    tabActive,
    liveRepoRef,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError,
    clearError: session.clearError
  })

  const refreshAfterFetch = (candidate: RepositoryIdentity): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(candidate).localBranches }),
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(candidate).remoteRefs }),
      commitHistory.restart(candidate)
    ])

  const refs = useRefsController({
    repoPath: path,
    repository,
    tabId,
    tabActive,
    remotes: session.remotes,
    defaultBranch: session.defaultBranch,
    statusCurrent: workingTreeStatus.status?.current,
    liveRepoRef,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    mutationCoordinator,
    refreshAfterFetch
  })

  useEffect(() => {
    const error = workingTreeStatus.statusError
    if (error) {
      session.setError(
        'status',
        gitFailureBannerText('Could not read the working tree', formatCause(error))
      )
      return
    }
    session.clearError('status')
  }, [workingTreeStatus.statusError, session.setError, session.clearError])

  useEffect(() => {
    const error = refs.localBranchesError ?? refs.remoteRefsError
    if (error) {
      session.setError('refs', gitFailureBannerText('Could not read branches', formatCause(error)))
      return
    }
    session.clearError('refs')
  }, [refs.localBranchesError, refs.remoteRefsError, session.setError, session.clearError])

  const reset = () => {
    commitHistory.reset()
  }

  const repoCacheQueryKey = (
    candidate: RepositoryIdentity,
    cache: RepoCache
  ): readonly unknown[] => {
    const queryKeys = repoQueryKeys(candidate)
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

  const refreshMappedCache = (candidate: RepositoryIdentity, cache: RepoCache): Promise<unknown> =>
    cache === 'log'
      ? commitHistory.restart(candidate)
      : queryClient.invalidateQueries({ queryKey: repoCacheQueryKey(candidate, cache) })

  const refreshCaches = (candidate: RepositoryIdentity, caches: readonly RepoCache[]) =>
    Promise.all(caches.map((cache) => refreshMappedCache(candidate, cache)))

  useLayoutEffect(() => {
    sessionLifecycle.current = {
      onRepoOpened: (opened, generation) => {
        const openedRepository = liveRepoRef.current ?? repositoryForPath(opened.path)
        void refreshCaches(openedRepository, ['status', 'localBranches', 'remoteRefs'])
        commitHistory.onRepoOpened(opened, generation)
      },
      onBeforeRepoClosed: (repoPath) => commitHistory.cancelStream(repoPath),
      onSessionReset: reset
    }
  })

  const actionRunner = useActionRunnerController({
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo: (generation, repoPath) => isCurrentRepo(generation, repositoryForPath(repoPath)),
    refreshCaches: (repoPath, caches) => refreshCaches(repositoryForPath(repoPath), caches),
    mutationCoordinator
  })

  const latest = useLatestRef({
    getRepository: () => liveRepoRef.current,
    isTabActive: () => tabActiveRef.current,
    openRepo: session.openRepo
  })

  useEffect(() => {
    const unsubRestarted = window.electronAPI.onSidecarRestarted(() => {
      const { getRepository, openRepo, isTabActive } = latest.current
      const currentRepository = getRepository()
      if (!currentRepository) {
        return
      }
      if (isTabActive()) {
        toast.info('Reconnecting git engine…')
      }
      void openRepo(currentRepository)
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
    repository: session.repoRef,
    handlers: repoChangedHandlers
  })

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRepoChanged((event) => {
      const { repository, handlers } = latestRepoChanged.current
      if (event.repoPath !== repository?.path) {
        return
      }
      void handlers.refreshCaches(repository, cachesForRepoChange(event.kind))
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <RepoSessionContext.Provider value={session.publicValue}>
      <WorkingTreeStatusProvider value={workingTreeStatus}>
        <CommitHistoryProvider value={commitHistory}>
          <RefsProvider value={refs}>
            <ActionRunnerProvider value={actionRunner}>
              <DetailSelectionProvider repoPath={session.repoPath}>
                {props.children}
              </DetailSelectionProvider>
            </ActionRunnerProvider>
          </RefsProvider>
        </CommitHistoryProvider>
      </WorkingTreeStatusProvider>
    </RepoSessionContext.Provider>
  )
}
