import { parseOrThrow } from '@shared/codec'
import { LOG_PAGE_SIZE } from '@shared/graph-config'
import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
import { StartLogStreamResponseSchema } from '@shared/schemas/ipc'
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
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'
import {
  emptyRepoSessionLifecycle,
  RepoSessionContext,
  type RepoSessionLifecycle,
  RepoSessionProvider,
  useRepoSession,
  useRepoSessionController
} from './repo-session'
import { useWorkingTreeStatusController, WorkingTreeStatusProvider } from './working-tree-status'

export type { RepoSession } from './repo-session'
export { useFileDiff, useWorkingTreeStatus } from './working-tree-status'
export { RepoSessionProvider, useRepoSession }

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000
const LOG_FLUSH_MS = 100
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
// (commit/push/pull progress and the push-based log-stream flags) that have no natural query of
// their own.
interface GitUiState {
  committing: boolean
  pushing: boolean
  pulling: boolean
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  lastFetchedAt: number | null
}

const initialUiState: GitUiState = {
  committing: false,
  pushing: false,
  pulling: false,
  logLoading: false,
  logLoadingMore: false,
  logHasMore: false,
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

  const logBuffer = useRef<GitLogEntry[]>([])
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openGeneration = session.openGenerationRef
  const logStreamSeq = useRef(0)

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

  // The log is push-based: chunks arrive over IPC and are written into the Query cache via
  // setQueryData. This disabled query subscribes the component to those cache writes — it never
  // fetches on its own.
  const logQuery = useQuery({
    queryKey: repoKeys.log,
    enabled: false,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: () => Promise.resolve<GitLog | null>(null)
  })

  const status = workingTreeStatus.status
  const branches = useMemo(
    () => combineBranches(localBranchesQuery.data, remoteRefsQuery.data),
    [localBranchesQuery.data, remoteRefsQuery.data]
  )
  const log = logQuery.data ?? null
  // Prefer the dedicated branch source over status.current: a branch-only refresh (e.g. renaming
  // the checked-out branch) updates localBranches but not status, and status.current would
  // otherwise keep showing the old name until an unrelated status refetch. Falls back to
  // status.current when there is no named branch (detached HEAD reports an empty current).
  const currentBranch = localBranchesQuery.data?.current || status?.current || ''

  const state: GitState = {
    repoPath: session.repoPath,
    status,
    log,
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
    logLoading: ui.logLoading,
    logLoadingMore: ui.logLoadingMore,
    logHasMore: ui.logHasMore,
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

  const flushLogToStore = (expectedGen: number, expectedPath: string | null) => {
    logFlushTimer.current = null
    if (expectedGen !== openGeneration.current || expectedPath !== liveRepoPath.current) {
      return
    }
    if (!expectedPath) {
      return
    }
    const logKey = repoQueryKeys(expectedPath).log
    const previous = queryClient.getQueryData<GitLog>(logKey)
    const nextLength = logBuffer.current.length
    if (nextLength === (previous?.all.length ?? 0) && previous?.total === nextLength) {
      return
    }
    queryClient.setQueryData<GitLog>(logKey, { all: [...logBuffer.current], total: nextLength })
  }

  const scheduleLogFlush = () => {
    if (logFlushTimer.current !== null) {
      return
    }
    const expectedGen = openGeneration.current
    const expectedPath = liveRepoPath.current
    logFlushTimer.current = setTimeout(() => {
      if (!tabActiveRef.current) {
        logFlushTimer.current = null
        if (logBuffer.current.length > 0) {
          scheduleLogFlush()
        }
        return
      }
      flushLogToStore(expectedGen, expectedPath)
    }, LOG_FLUSH_MS)
  }

  const reset = () => {
    logBuffer.current = []
    if (logFlushTimer.current !== null) {
      clearTimeout(logFlushTimer.current)
      logFlushTimer.current = null
    }
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
      ? restartLogStream(repoPath)
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

  const restartLogStream = async (
    repoPath: string,
    options?: { clearLog?: boolean; skip?: number; maxCount?: number }
  ) => {
    const generation = openGeneration.current
    if (!isCurrentRepo(generation, repoPath)) {
      return
    }
    const skip = options?.skip ?? 0
    const maxCount = options?.maxCount ?? LOG_PAGE_SIZE
    const append = skip > 0
    const clearLog = options?.clearLog ?? !append

    // Stamp this start so in-flight chunks from a previous stream (same repoPath, older id) are
    // dropped by onLogChunk instead of landing in the freshly-cleared buffer.
    const streamId = ++logStreamSeq.current

    if (!append) {
      logBuffer.current = []
      if (clearLog) {
        queryClient.setQueryData<GitLog>(repoQueryKeys(repoPath).log, { all: [], total: 0 })
        setUi('logHasMore', false)
      }
      setUi('logLoading', true)
    } else {
      setUi('logLoadingMore', true)
    }

    try {
      await window.electronAPI.cancelLogStream(repoPath).catch(() => {})
      const response = parseOrThrow(
        StartLogStreamResponseSchema,
        await window.electronAPI.startLogStream(repoPath, { skip, maxCount, streamId })
      )
      if (!isCurrentRepo(generation, repoPath)) {
        return
      }
      if (response._tag === 'GitError') {
        session.setError(response.message)
        setUi(append ? 'logLoadingMore' : 'logLoading', false)
      }
    } catch (error) {
      if (!isCurrentRepo(generation, repoPath)) {
        return
      }
      session.setError(formatCause(error))
      setUi(append ? 'logLoadingMore' : 'logLoading', false)
    }
  }

  const loadMoreHistory = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || !ui.logHasMore || ui.logLoadingMore || ui.logLoading) {
      return
    }
    // The cache holds the last throttled flush; the buffer may already hold more commits still
    // draining in. Skipping by the smaller of the two would re-request buffered commits or gap.
    const cached = queryClient.getQueryData<GitLog>(repoQueryKeys(repoPath).log)
    const skip = Math.max(logBuffer.current.length, cached?.all.length ?? 0)
    await restartLogStream(repoPath, { skip, maxCount: LOG_PAGE_SIZE, clearLog: false })
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

  const runIfCurrent = (
    generation: number,
    repoPath: string,
    label: string,
    task: () => Promise<void>
  ) => {
    void task().catch((error: unknown) => {
      if (!isCurrentRepo(generation, repoPath)) {
        return
      }
      console.error(`[git] ${label} failed for ${repoPath}:`, formatCause(error))
      session.setError(formatCause(error))
    })
  }

  const startRepoRefresh = (
    repoPath: string,
    generation: number,
    options?: { clearLogOnStream?: boolean }
  ) => {
    runIfCurrent(generation, repoPath, 'restartLogStream', async () => {
      await restartLogStream(repoPath, {
        clearLog: options?.clearLogOnStream ?? true
      })
    })
  }

  sessionLifecycle.current = {
    onRepoOpened: (opened, generation) => {
      const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(opened.path).log)
      setUi({
        logLoading: false,
        logLoadingMore: false,
        logHasMore: false
      })
      logBuffer.current = cachedLog?.all ? [...cachedLog.all] : []
      void refreshCaches(opened.path, ['status', 'localBranches', 'remoteRefs'])
      startRepoRefresh(opened.path, generation, {
        clearLogOnStream: !cachedLog
      })
    },
    onBeforeRepoClosed: (repoPath) =>
      Promise.resolve(window.electronAPI.cancelLogStream(repoPath))
        .then(() => undefined)
        .catch(() => {}),
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

  useEffect(() => {
    if (tabActive && logBuffer.current.length > 0) {
      scheduleLogFlush()
    }
  })

  // The IPC subscriptions below register once (`[]` deps) and must read the current helpers, not
  // render-zero closures. The helpers are recreated each render, so the subscriptions read them
  // through this ref.
  const latest = useRef({
    getOpenGeneration: () => openGeneration.current,
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    setError: session.setError,
    scheduleLogFlush,
    flushLogToStore,
    runFetchAndRefresh,
    openRepo: session.openRepo
  })
  latest.current = {
    getOpenGeneration: () => openGeneration.current,
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    setError: session.setError,
    scheduleLogFlush,
    flushLogToStore,
    runFetchAndRefresh,
    openRepo: session.openRepo
  }

  useEffect(() => {
    const unsubLog = window.electronAPI.onLogChunk((chunk) => {
      const {
        getOpenGeneration,
        getRepoPath,
        isTabActive,
        scheduleLogFlush,
        flushLogToStore,
        setError
      } = latest.current
      if (chunk.repoPath !== getRepoPath()) {
        return
      }
      if (chunk.streamId !== undefined && chunk.streamId !== logStreamSeq.current) {
        return
      }
      if (chunk.commits.length > 0) {
        for (const commit of chunk.commits) {
          logBuffer.current.push(commit)
        }
        scheduleLogFlush()
      }
      if (chunk.error) {
        setError(chunk.error)
      }
      if (chunk.done) {
        if (chunk.hasMore !== undefined) {
          setUi('logHasMore', chunk.hasMore)
        }
        setUi('logLoading', false)
        setUi('logLoadingMore', false)
        if (isTabActive()) {
          flushLogToStore(getOpenGeneration(), getRepoPath())
        }
      }
    })

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
      unsubLog?.()
      unsubRestarted?.()
    }
  }, [setUi])

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
    loadMoreHistory
  }

  return {
    git,
    session,
    workingTreeStatus: workingTreeStatus.value,
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
  const { git, session, workingTreeStatus, repoChangedHandlers } = useGitStoreValue(
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
        <GitStoreContext.Provider value={git}>{props.children}</GitStoreContext.Provider>
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
