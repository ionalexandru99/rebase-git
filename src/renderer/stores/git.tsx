import { Commit, Pull, Push } from '@shared/rpc'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { cachesForOperation, type MappedOperation, type RepoCache } from '@/lib/operation-caches'
import { repoQueryKeys } from '@/lib/query-keys'
import { rpcCommit, rpcPull, rpcPush } from '@/lib/rpc-client'
import type { GitBranches, GitLog, GitStatus } from '@/types'
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

export { useCommitHistory } from './commit-history'
export { useRefs } from './refs'
export type { RepoSession } from './repo-session'
export { useFileDiff, useWorkingTreeStatus } from './working-tree-status'
export { RepoSessionProvider, useRepoSession }

export interface GitState {
  repoPath: string | null
  status: GitStatus | null
  log: GitLog | null
  branches: GitBranches | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  currentBranch: string
  opening: boolean
  committing: boolean
  pushing: boolean
  pulling: boolean
  statusLoading: boolean
  branchesLoading: boolean
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  lastFetchedAt: number | null
  error: string | null
}

const formatCause = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

function useGitStoreValue(tabId: string, tabActive: boolean) {
  const queryClient = useQueryClient()
  const sessionLifecycle = useRef<RepoSessionLifecycle>(emptyRepoSessionLifecycle)
  const session = useRepoSessionController(sessionLifecycle)

  const path = session.repoPath

  // Long-lived async closures (IPC subscriptions and query/mutation callbacks) must
  // read the live repo, not the render-zero value, so they go through this ref refreshed each
  // render.
  const liveRepoPath = session.liveRepoPath
  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const openGeneration = session.openGenerationRef

  const isCurrentRepo = (generation: number, repoPath: string) =>
    generation === openGeneration.current && liveRepoPath.current === repoPath

  const workingTreeStatus = useWorkingTreeStatusController({
    repoPath: path,
    tabId,
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError
  })

  const commitHistory = useCommitHistoryController({
    repoPath: path,
    tabId,
    tabActive,
    liveRepoPath,
    openGenerationRef: openGeneration,
    isCurrentRepo,
    setError: session.setError
  })

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
    setError: session.setError
  })

  const status = workingTreeStatus.status

  useEffect(() => {
    const error = workingTreeStatus.statusError ?? refs.localBranchesError ?? refs.remoteRefsError
    if (error) {
      session.setError(formatCause(error))
    }
  }, [
    workingTreeStatus.statusError,
    refs.localBranchesError,
    refs.remoteRefsError,
    session.setError
  ])

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
    }
  }

  // The log is push-based (chunks written via setQueryData), so "dirtying" it means restarting the
  // stream, not invalidating a query — every other cache is a normal query refetch.
  const refreshMappedCache = (repoPath: string, cache: RepoCache): Promise<unknown> =>
    cache === 'log'
      ? commitHistory.restart(repoPath)
      : queryClient.invalidateQueries({ queryKey: repoCacheQueryKey(repoPath, cache) })

  // The one invalidation primitive every path shares: name the caches a change dirties and they
  // refresh through the same cache→key switch. Actions read their list from the op→caches map; the
  // bespoke paths (open, fetch, external change) pass an explicit list.
  const refreshCaches = (repoPath: string, caches: readonly RepoCache[]): Promise<unknown> =>
    Promise.all(caches.map((cache) => refreshMappedCache(repoPath, cache)))

  // The single action runner: call the typed op, then refresh exactly the caches the op→caches map
  // names — no per-action refresh-bundle choice. Ok toasts success; a Conflict refreshes the same
  // caches but routes to the resolve-the-conflict path (warning, not error). A Git error (or any
  // other non-Ok outcome) toasts and refreshes nothing.
  const runAction = async (
    operation: MappedOperation,
    call: (repoPath: string) => Promise<{ _tag: string; message?: string }>,
    label: string
  ): Promise<boolean> => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      toast.error('Repository is not open')
      return false
    }
    try {
      const response = await call(repoPath)
      if (response._tag === 'Ok' || response._tag === 'Conflict') {
        await refreshCaches(repoPath, cachesForOperation(operation))
      }
      if (response._tag === 'Ok') {
        toast.success(label)
        return true
      }
      if (response._tag === 'Conflict') {
        toast.warning(`${label} hit conflicts`, {
          description: 'Resolve the conflicted files, then commit or abort.'
        })
        return false
      }
      if (response._tag === 'GitError') {
        toast.error(`${label} failed`, { description: response.message })
        return false
      }
      toast.error('Repository is not open')
      return false
    } catch (error) {
      toast.error(`${label} failed`, { description: formatCause(error) })
      return false
    }
  }

  sessionLifecycle.current = {
    onRepoOpened: (opened, generation) => {
      void refreshCaches(opened.path, ['status', 'localBranches', 'remoteRefs'])
      commitHistory.onRepoOpened(opened, generation)
    },
    onBeforeRepoClosed: (repoPath) => commitHistory.cancelStream(repoPath),
    onSessionReset: reset
  }

  const commitMutation = useMutation({
    mutationFn: (message: string) =>
      runAction(Commit._tag, (repoPath) => rpcCommit(repoPath, message), 'Committed')
  })
  const pushMutation = useMutation({
    mutationFn: () => runAction(Push._tag, (repoPath) => rpcPush(repoPath), 'Pushed')
  })
  const pullMutation = useMutation({
    mutationFn: () => runAction(Pull._tag, (repoPath) => rpcPull(repoPath), 'Pulled')
  })

  const state: GitState = {
    repoPath: session.repoPath,
    status,
    log: commitHistory.log,
    branches: refs.branches,
    remotes: session.remotes,
    defaultBranch: session.defaultBranch,
    currentBranch: refs.currentBranch,
    opening: session.opening,
    committing: commitMutation.isPending,
    pushing: pushMutation.isPending,
    pulling: pullMutation.isPending,
    statusLoading: workingTreeStatus.statusLoading,
    branchesLoading: refs.branchesLoading,
    logLoading: commitHistory.logLoading,
    logLoadingMore: commitHistory.logLoadingMore,
    logHasMore: commitHistory.logHasMore,
    lastFetchedAt: refs.lastFetchedAt,
    error: session.error
  }

  // The IPC subscription below registers once (`[]` deps) and must read the current helpers, not
  // render-zero closures. The helpers are recreated each render, so it reads them through this ref.
  const latest = useRef({
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    openRepo: session.openRepo
  })
  latest.current = {
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    openRepo: session.openRepo
  }

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

  const git = {
    state,
    loading: session.opening || commitMutation.isPending,
    openRepo: session.openRepo,
    closeRepo: session.closeRepo,
    stageFile: workingTreeStatus.value.stageFile,
    unstageFile: workingTreeStatus.value.unstageFile,
    stageAll: workingTreeStatus.value.stageAll,
    unstageAll: workingTreeStatus.value.unstageAll,
    stageHunk: workingTreeStatus.value.stageHunk,
    unstageHunk: workingTreeStatus.value.unstageHunk,
    commit: (message: string) => commitMutation.mutateAsync(message),
    fetchNow: refs.fetchNow,
    pushNow: () => pushMutation.mutateAsync(),
    pullNow: () => pullMutation.mutateAsync(),
    runAction,
    loadMoreHistory: commitHistory.value.loadMoreHistory
  }

  return {
    git,
    session,
    workingTreeStatus: workingTreeStatus.value,
    commitHistory: commitHistory.value,
    refs: refs.value,
    repoChangedHandlers: { refreshCaches }
  }
}

type GitStoreValue = ReturnType<typeof useGitStoreValue>

export type GitStore = GitStoreValue['git']

const GitStoreContext = createContext<GitStore | null>(null)

interface GitStoreProviderProps {
  tabId: string
  tabActive: boolean
  children: ReactNode
}

export function GitStoreProvider(props: GitStoreProviderProps) {
  const { git, session, workingTreeStatus, commitHistory, refs, repoChangedHandlers } =
    useGitStoreValue(props.tabId, props.tabActive)
  const latestRepoChanged = useRef({
    repoPath: session.repoPath,
    handlers: repoChangedHandlers
  })
  latestRepoChanged.current = {
    repoPath: session.repoPath,
    handlers: repoChangedHandlers
  }

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRepoChanged((event) => {
      const { repoPath, handlers } = latestRepoChanged.current
      if (event.repoPath !== repoPath) {
        return
      }
      const caches: RepoCache[] =
        event.kind === 'refs'
          ? ['localBranches', 'remoteRefs', 'log', 'stash']
          : ['status', 'diff', 'stash']
      void handlers.refreshCaches(event.repoPath, caches)
    })
    return () => unsubscribe?.()
  }, [])

  return (
    <RepoSessionContext.Provider value={session.publicValue}>
      <WorkingTreeStatusProvider value={workingTreeStatus}>
        <CommitHistoryProvider value={commitHistory}>
          <RefsProvider value={refs}>
            <GitStoreContext.Provider value={git}>{props.children}</GitStoreContext.Provider>
          </RefsProvider>
        </CommitHistoryProvider>
      </WorkingTreeStatusProvider>
    </RepoSessionContext.Provider>
  )
}

export function useGitStore(): GitStore {
  const value = useContext(GitStoreContext)
  if (!value) {
    throw new Error('useGitStore must be used within a GitStoreProvider')
  }
  return value
}
