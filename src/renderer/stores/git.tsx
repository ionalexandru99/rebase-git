import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import { cachesForOperation, type MappedOperation, type RepoCache } from '@/lib/operation-caches'
import { repoQueryKeys } from '@/lib/query-keys'
import {
  rpcCommit,
  rpcFetch,
  rpcGetLocalBranches,
  rpcGetRemoteRefs,
  rpcPull,
  rpcPush
} from '@/lib/rpc-client'
import type { GitBranches, GitLog, GitStatus } from '@/types'
import { CommitHistoryProvider, useCommitHistoryController } from './commit-history'
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
export type { RepoSession } from './repo-session'
export { useFileDiff, useWorkingTreeStatus } from './working-tree-status'
export { RepoSessionProvider, useRepoSession }

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000
// Closed repos keep their status/branches/log cached this long so reopening repaints instantly —
// the role the per-repo snapshot Map used to play. Scoped to these queries (not the global default)
// so transient diff/hunk-highlight queries still expire on the normal schedule.
const WARM_REOPEN_GC_TIME_MS = 30 * 60 * 1000

const combineBranches = (
  local: LocalBranches | undefined,
  remote: RemoteRefs | undefined
): GitBranches | null => {
  if (!local && !remote) {
    return null
  }
  return {
    current: local?.current ?? '',
    all: local?.all ?? [],
    remotes: remote?.remotes ?? [],
    tags: remote?.tags ?? [],
    tracking: local?.tracking
  }
}

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

type SetGitUiState = {
  (next: Partial<GitUiState>): void
  <K extends keyof GitUiState>(key: K, value: GitUiState[K]): void
}

// Server state lives only in the TanStack Query cache. This store holds the imperative UI flags
// (commit/push/pull progress) that have no natural query of their own. The push-based log-stream
// flags live in the commit-history module.
interface GitUiState {
  committing: boolean
  pushing: boolean
  pulling: boolean
  lastFetchedAt: number | null
}

const initialUiState: GitUiState = {
  committing: false,
  pushing: false,
  pulling: false,
  lastFetchedAt: null
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

const parseLocalBranchesResponse = (response: {
  _tag: string
  branches?: LocalBranches
  message?: string
}): LocalBranches => {
  if (response._tag === 'Ok' && response.branches) {
    return response.branches
  }
  if (response._tag === 'GitError') {
    throw new Error(response.message ?? 'Git error')
  }
  throw new Error('Repository not open')
}

const parseRemoteRefsResponse = (response: {
  _tag: string
  refs?: RemoteRefs
  message?: string
}): RemoteRefs => {
  if (response._tag === 'Ok' && response.refs) {
    return response.refs
  }
  if (response._tag === 'GitError') {
    throw new Error(response.message ?? 'Git error')
  }
  throw new Error('Repository not open')
}

const fetchLocalBranches = async (path: string): Promise<LocalBranches> => {
  const response = await rpcGetLocalBranches(path)
  return parseLocalBranchesResponse(response)
}

const fetchRemoteRefs = async (path: string): Promise<RemoteRefs> => {
  const response = await rpcGetRemoteRefs(path)
  return parseRemoteRefsResponse(response)
}

function useGitStoreValue(tabId: string, tabActive: boolean) {
  const queryClient = useQueryClient()
  const sessionLifecycle = useRef<RepoSessionLifecycle>(emptyRepoSessionLifecycle)
  const session = useRepoSessionController(sessionLifecycle)
  const [ui, setUiState] = useState<GitUiState>({ ...initialUiState })
  const setUi = useCallback(
    ((keyOrNext: keyof GitUiState | Partial<GitUiState>, value?: unknown) => {
      setUiState((previous) => {
        if (typeof keyOrNext === 'string') {
          if (Object.is(previous[keyOrNext], value)) {
            return previous
          }
          return { ...previous, [keyOrNext]: value }
        }
        return { ...previous, ...keyOrNext }
      })
    }) as SetGitUiState,
    []
  )

  const path = session.repoPath
  const repoKeys = repoQueryKeys(path, { idle: tabId })

  // Long-lived async closures (IPC subscriptions and query/mutation callbacks) must
  // read the live repo, not the render-zero value, so they go through this ref refreshed each
  // render.
  const liveRepoPath = session.liveRepoPath
  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const [fetchTick, setFetchTick] = useState(0)

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

  const localBranchesQuery = useQuery({
    queryKey: repoKeys.localBranches,
    enabled: Boolean(path),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchLocalBranches(queryKey[1] as string)
  })

  const remoteRefsQuery = useQuery({
    queryKey: repoKeys.remoteRefs,
    enabled: Boolean(path) && Boolean(localBranchesQuery.data),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchRemoteRefs(queryKey[1] as string)
  })

  const status = workingTreeStatus.status
  const branches = useMemo(
    () => combineBranches(localBranchesQuery.data, remoteRefsQuery.data),
    [localBranchesQuery.data, remoteRefsQuery.data]
  )
  // Prefer the dedicated branch source over status.current: a branch-only refresh (e.g. renaming
  // the checked-out branch) updates localBranches but not status, and status.current would
  // otherwise keep showing the old name until an unrelated status refetch. Falls back to
  // status.current when there is no named branch (detached HEAD reports an empty current).
  const currentBranch = localBranchesQuery.data?.current || status?.current || ''

  const state: GitState = {
    repoPath: session.repoPath,
    status,
    log: commitHistory.log,
    branches,
    remotes: session.remotes,
    defaultBranch: session.defaultBranch,
    currentBranch,
    opening: session.opening,
    committing: ui.committing,
    pushing: ui.pushing,
    pulling: ui.pulling,
    statusLoading: workingTreeStatus.statusLoading,
    branchesLoading: localBranchesQuery.isFetching && !localBranchesQuery.data,
    logLoading: commitHistory.logLoading,
    logLoadingMore: commitHistory.logLoadingMore,
    logHasMore: commitHistory.logHasMore,
    lastFetchedAt: ui.lastFetchedAt,
    error: session.error
  }

  useEffect(() => {
    const error = workingTreeStatus.statusError ?? localBranchesQuery.error ?? remoteRefsQuery.error
    if (error) {
      session.setError(formatCause(error))
    }
  }, [
    workingTreeStatus.statusError,
    localBranchesQuery.error,
    remoteRefsQuery.error,
    session.setError
  ])

  const reset = () => {
    commitHistory.reset()
    setUi({ ...initialUiState })
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
  // bespoke paths (open, commit, push, pull, fetch, external change) pass an explicit list.
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

  const runFetchAndRefresh = async (repoPath: string) => {
    const generation = openGeneration.current
    if (!isCurrentRepo(generation, repoPath)) {
      return
    }
    const response = await rpcFetch(repoPath)
    if (!isCurrentRepo(generation, repoPath)) {
      return
    }
    if (response._tag === 'Ok') {
      setUi('lastFetchedAt', Date.now())
      if (tabActiveRef.current) {
        await refreshCaches(repoPath, ['localBranches', 'remoteRefs'])
      }
    } else if (response._tag === 'GitError') {
      session.setError(response.message)
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
    mutationFn: async (message: string) => {
      const repoPath = liveRepoPath.current
      if (!repoPath) {
        return false
      }
      const generation = openGeneration.current
      setUi('committing', true)
      try {
        const response = await rpcCommit(repoPath, message)
        if (!isCurrentRepo(generation, repoPath)) {
          return false
        }
        if (response._tag === 'Ok') {
          await refreshCaches(repoPath, ['status', 'diff', 'log'])
          return true
        }
        if (response._tag === 'GitError') {
          session.setError(response.message)
        }
        return false
      } catch (error) {
        if (isCurrentRepo(generation, repoPath)) {
          session.setError(formatCause(error))
        }
        return false
      } finally {
        if (isCurrentRepo(generation, repoPath)) {
          setUi('committing', false)
        }
      }
    }
  })

  // The IPC subscription below registers once (`[]` deps) and must read the current helpers, not
  // render-zero closures. The helpers are recreated each render, so it reads them through this ref.
  const latest = useRef({
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    runFetchAndRefresh,
    openRepo: session.openRepo
  })
  latest.current = {
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    runFetchAndRefresh,
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

  const repoPathValue = session.repoPath
  useEffect(() => {
    // fetchTick is a dependency on purpose: a manual fetch bumps it, re-running this effect and
    // restarting the interval, so the 5-minute cadence resets and we never auto-fetch right after a
    // manual one. Trade-off: fetching manually more often than every 5 minutes postpones the
    // independent auto-fetch indefinitely — acceptable, since the user is already fetching.
    void fetchTick
    if (!repoPathValue) {
      return
    }
    const handle = window.setInterval(() => {
      const { isTabActive, runFetchAndRefresh } = latest.current
      if (isTabActive()) {
        void runFetchAndRefresh(repoPathValue)
      }
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [repoPathValue, fetchTick])

  const fetchNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      return
    }
    const generation = openGeneration.current
    setFetchTick((tick) => tick + 1)
    try {
      await runFetchAndRefresh(repoPath)
    } catch (error) {
      if (isCurrentRepo(generation, repoPath)) {
        session.setError(formatCause(error))
      }
    }
  }

  const pushNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || ui.pushing) {
      return
    }
    const generation = openGeneration.current
    setUi('pushing', true)
    try {
      const response = await rpcPush(repoPath)
      if (!isCurrentRepo(generation, repoPath)) {
        return
      }
      if (response._tag === 'Ok') {
        await refreshCaches(repoPath, ['localBranches', 'remoteRefs'])
      } else if (response._tag === 'GitError') {
        session.setError(response.message)
      }
    } catch (error) {
      if (isCurrentRepo(generation, repoPath)) {
        session.setError(formatCause(error))
      }
    } finally {
      if (isCurrentRepo(generation, repoPath)) {
        setUi('pushing', false)
      }
    }
  }

  const pullNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || ui.pulling) {
      return
    }
    const generation = openGeneration.current
    setUi('pulling', true)
    try {
      const response = await rpcPull(repoPath)
      if (!isCurrentRepo(generation, repoPath)) {
        return
      }
      if (response._tag === 'Ok') {
        await refreshCaches(repoPath, ['status', 'localBranches', 'remoteRefs', 'diff', 'log'])
      } else if (response._tag === 'GitError') {
        session.setError(response.message)
      }
    } catch (error) {
      if (isCurrentRepo(generation, repoPath)) {
        session.setError(formatCause(error))
      }
    } finally {
      if (isCurrentRepo(generation, repoPath)) {
        setUi('pulling', false)
      }
    }
  }

  const git = {
    state,
    loading: session.opening || ui.committing,
    openRepo: session.openRepo,
    closeRepo: session.closeRepo,
    stageFile: workingTreeStatus.value.stageFile,
    unstageFile: workingTreeStatus.value.unstageFile,
    stageAll: workingTreeStatus.value.stageAll,
    unstageAll: workingTreeStatus.value.unstageAll,
    stageHunk: workingTreeStatus.value.stageHunk,
    unstageHunk: workingTreeStatus.value.unstageHunk,
    commit: (message: string) => commitMutation.mutateAsync(message),
    fetchNow,
    pushNow,
    pullNow,
    runAction,
    loadMoreHistory: commitHistory.value.loadMoreHistory
  }

  return {
    git,
    session,
    workingTreeStatus: workingTreeStatus.value,
    commitHistory: commitHistory.value,
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
  const { git, session, workingTreeStatus, commitHistory, repoChangedHandlers } = useGitStoreValue(
    props.tabId,
    props.tabActive
  )
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
          <GitStoreContext.Provider value={git}>{props.children}</GitStoreContext.Provider>
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
