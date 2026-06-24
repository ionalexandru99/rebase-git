import { parseOrThrow } from '@shared/codec'
import { LOG_PAGE_SIZE } from '@shared/graph-config'
import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
import { OpenRepoResponseSchema, StartLogStreamResponseSchema } from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { stashKey } from '@/hooks/git/useStashes'
import { repoQueryKeys } from '@/lib/query-keys'
import {
  rpcCommit,
  rpcFetch,
  rpcPull,
  rpcPush,
  rpcStageAll,
  rpcStageFile,
  rpcStageHunk,
  rpcUnstageAll,
  rpcUnstageFile,
  rpcUnstageHunk
} from '@/lib/rpc-client'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

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

interface HunkStageOptions {
  fullyStagesFile?: boolean
  fullyUnstagesFile?: boolean
}

type SetGitUiState = {
  (next: Partial<GitUiState>): void
  <K extends keyof GitUiState>(key: K, value: GitUiState[K]): void
}

// Server state lives only in the TanStack Query cache. This store holds the imperative UI flags
// (open/commit/push/pull progress, the push-based log-stream flags, the last error) that have no
// natural query of their own.
interface GitUiState {
  repoPath: string | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  opening: boolean
  committing: boolean
  pushing: boolean
  pulling: boolean
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  lastFetchedAt: number | null
  error: string | null
}

const initialUiState: GitUiState = {
  repoPath: null,
  remotes: {},
  defaultBranch: undefined,
  opening: false,
  committing: false,
  pushing: false,
  pulling: false,
  logLoading: false,
  logLoadingMore: false,
  logHasMore: false,
  lastFetchedAt: null,
  error: null
}

type StatusMutationResult =
  | { _tag: 'Ok' }
  | { _tag: 'RepoNotOpen' }
  | { _tag: 'GitError'; message: string }
  | { _tag: 'HunkNotFound' }

interface StatusMutationContext {
  path: string
  key: readonly unknown[]
  previous: GitStatus | undefined
  hadOptimistic: boolean
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
  const response = await sidecarFetch(SidecarOp.getLocalBranches, { repoPath: path })
  return parseLocalBranchesResponse(response)
}

const fetchRemoteRefs = async (path: string): Promise<RemoteRefs> => {
  const response = await sidecarFetch(SidecarOp.getRemoteRefs, { repoPath: path })
  return parseRemoteRefsResponse(response)
}

const withoutFile = (files: string[], file: string): string[] => files.filter((f) => f !== file)
const withFile = (files: string[], file: string): string[] =>
  files.includes(file) ? files : [...files, file]

const stageCodes = (index: string, workingDir: string): { index: string; working_dir: string } => {
  if (index === '?' || workingDir === '?') {
    return { index: 'A', working_dir: ' ' }
  }
  return { index: workingDir !== ' ' ? workingDir : index, working_dir: ' ' }
}

const unstageCodes = (index: string): { index: string; working_dir: string } => {
  if (index === 'A') {
    return { index: '?', working_dir: '?' }
  }
  return { index: ' ', working_dir: index !== ' ' ? index : 'M' }
}

type StatusFileCode = NonNullable<GitStatus['files']>[number]

const mapFileCodes = (
  status: GitStatus,
  file: string,
  next: (entry: StatusFileCode) => { index: string; working_dir: string }
): StatusFileCode[] =>
  (status.files ?? []).map((entry) => (entry.path === file ? { ...entry, ...next(entry) } : entry))

const applyStage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withFile(status.staged, file),
  modified: withoutFile(status.modified, file),
  not_added: withoutFile(status.not_added, file),
  created: withoutFile(status.created, file),
  deleted: withoutFile(status.deleted, file),
  files: mapFileCodes(status, file, (entry) => stageCodes(entry.index, entry.working_dir))
})

const applyUnstage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withoutFile(status.staged, file),
  modified: withFile(status.modified, file),
  files: mapFileCodes(status, file, (entry) => unstageCodes(entry.index))
})

export function useGitStore(tabId: string, tabActive: boolean) {
  const queryClient = useQueryClient()
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

  const path = ui.repoPath
  const repoKeys = path ? repoQueryKeys(path) : null
  const idleKey = (kind: string) => ['repo', 'idle', tabId, kind] as const

  // Long-lived async closures (IPC subscription, unmount cleanup, query/mutation callbacks) must
  // read the live repo, not the render-zero value, so they go through this ref refreshed each
  // render.
  const liveRepoPath = useRef(path)
  liveRepoPath.current = path
  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const [fetchTick, setFetchTick] = useState(0)

  const logBuffer = useRef<GitLogEntry[]>([])
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountCleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openGeneration = useRef(0)
  const logStreamSeq = useRef(0)

  // The queryFn fetches the repo encoded in its own key, not `liveRepoPath`: a refetch already in
  // flight when this tab is redirected to another repo must still resolve against the repo it was
  // started for, never write another repo's data under this key.
  const statusQuery = useQuery({
    queryKey: repoKeys?.status ?? idleKey('status'),
    enabled: Boolean(path),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: async ({ queryKey }) => {
      const repoPath = queryKey[1] as string
      const response = await sidecarFetch('get-status', { repoPath })
      if (response._tag === 'GitError') {
        throw new Error(response.message)
      }
      if (response._tag !== 'Ok') {
        throw new Error('Repository not open')
      }
      return response.status
    }
  })

  const localBranchesQuery = useQuery({
    queryKey: repoKeys?.localBranches ?? idleKey('local-branches'),
    enabled: Boolean(path),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchLocalBranches(queryKey[1] as string)
  })

  const remoteRefsQuery = useQuery({
    queryKey: repoKeys?.remoteRefs ?? idleKey('remote-refs'),
    enabled: Boolean(path) && Boolean(localBranchesQuery.data),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchRemoteRefs(queryKey[1] as string)
  })

  // The log is push-based: chunks arrive over IPC and are written into the Query cache via
  // setQueryData. This disabled query subscribes the component to those cache writes — it never
  // fetches on its own.
  const logQuery = useQuery({
    queryKey: repoKeys?.log ?? idleKey('log'),
    enabled: false,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: () => Promise.resolve<GitLog | null>(null)
  })

  const status = statusQuery.data ?? null
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
    repoPath: ui.repoPath,
    status,
    log,
    branches,
    remotes: ui.remotes,
    defaultBranch: ui.defaultBranch,
    currentBranch,
    opening: ui.opening,
    committing: ui.committing,
    pushing: ui.pushing,
    pulling: ui.pulling,
    statusLoading: statusQuery.isFetching && !statusQuery.data,
    branchesLoading: localBranchesQuery.isFetching && !localBranchesQuery.data,
    logLoading: ui.logLoading,
    logLoadingMore: ui.logLoadingMore,
    logHasMore: ui.logHasMore,
    lastFetchedAt: ui.lastFetchedAt,
    error: ui.error
  }

  useEffect(() => {
    const error = statusQuery.error ?? localBranchesQuery.error ?? remoteRefsQuery.error
    if (error) {
      setUi('error', formatCause(error))
    }
  }, [statusQuery.error, localBranchesQuery.error, remoteRefsQuery.error, setUi])

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

  const invalidateRepoQueries = (repoPath: string) => {
    const queryKeys = repoQueryKeys(repoPath)
    void queryClient.invalidateQueries({ queryKey: queryKeys.status })
    void queryClient.invalidateQueries({ queryKey: queryKeys.localBranches })
    void queryClient.invalidateQueries({ queryKey: queryKeys.remoteRefs })
  }

  const invalidateDiffs = (repoPath: string) =>
    queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).diffRoot })

  const invalidateStashes = (repoPath: string) =>
    queryClient.invalidateQueries({ queryKey: stashKey(repoPath) })

  const refreshStatus = (repoPath: string) =>
    queryClient.invalidateQueries({ queryKey: repoQueryKeys(repoPath).status })

  const refreshBranchesOnly = async (repoPath: string): Promise<void> => {
    const queryKeys = repoQueryKeys(repoPath)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.localBranches }),
      queryClient.invalidateQueries({ queryKey: queryKeys.remoteRefs })
    ])
  }

  const refreshAfterCheckout = async (repoPath: string) => {
    const queryKeys = repoQueryKeys(repoPath)
    await Promise.all([
      queryClient.cancelQueries({ queryKey: queryKeys.status }),
      queryClient.cancelQueries({ queryKey: queryKeys.localBranches })
    ])
    await Promise.all([refreshStatus(repoPath), refreshBranchesOnly(repoPath)])
  }

  // Operations that move HEAD or rewrite history (merge, reset, revert, cherry-pick, create+
  // checkout) change which commits are reachable, so the log stream must be restarted on top of the
  // status/branch refresh.
  const refreshAfterMutation = async (repoPath: string) => {
    await Promise.all([refreshStatus(repoPath), refreshBranchesOnly(repoPath)])
    void invalidateDiffs(repoPath)
    await restartLogStream(repoPath)
  }

  // Working-tree-only operations (discard, stash apply/pop/push) change file state but not the
  // commit graph, so the log stream is left alone.
  const refreshWorkingTree = async (repoPath: string) => {
    await refreshStatus(repoPath)
    void invalidateDiffs(repoPath)
    void invalidateStashes(repoPath)
  }

  const restartLogStream = async (
    repoPath: string,
    options?: { clearLog?: boolean; skip?: number; maxCount?: number }
  ) => {
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
      if (response._tag === 'GitError') {
        setUi('error', response.message)
        setUi(append ? 'logLoadingMore' : 'logLoading', false)
      }
    } catch (error) {
      setUi('error', formatCause(error))
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
    const response = await rpcFetch(repoPath)
    if (response._tag === 'Ok') {
      setUi('lastFetchedAt', Date.now())
      if (tabActiveRef.current) {
        await refreshBranchesOnly(repoPath)
      }
    } else if (response._tag === 'GitError') {
      setUi('error', response.message)
    }
  }

  const runIfCurrent = (
    generation: number,
    repoPath: string,
    label: string,
    task: () => Promise<void>
  ) => {
    void task().catch((error: unknown) => {
      if (generation !== openGeneration.current || liveRepoPath.current !== repoPath) {
        return
      }
      console.error(`[git] ${label} failed for ${repoPath}:`, formatCause(error))
      setUi('error', formatCause(error))
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

  const openRepo = async (requestedPath: string): Promise<string | null> => {
    const generation = ++openGeneration.current
    setUi('opening', true)
    setUi('error', null)

    try {
      const openResponse = parseOrThrow(
        OpenRepoResponseSchema,
        await window.electronAPI.openRepo(requestedPath)
      )
      if (generation !== openGeneration.current) {
        if (openResponse._tag === 'Ok') {
          void window.electronAPI.closeRepo(openResponse.result.path).catch(() => {})
        }
        return null
      }

      if (openResponse._tag !== 'Ok') {
        const errorMessage =
          openResponse._tag === 'NotARepo' ? 'Not a git repository' : openResponse.message
        setUi('error', errorMessage)
        setUi('opening', false)
        return null
      }

      const opened = openResponse.result
      // status / branches / log paint instantly from the warm Query cache (keyed by repoPath); the
      // invalidate + log-stream restart below replace them with fresh data.
      const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(opened.path).log)

      setUi({
        repoPath: opened.path,
        remotes: opened.remotes,
        defaultBranch: opened.defaultBranch,
        opening: false,
        logLoading: false,
        logLoadingMore: false,
        logHasMore: false
      })

      logBuffer.current = cachedLog?.all ? [...cachedLog.all] : []

      // Mark before the render that subscribes the per-path queries: cached entries refetch
      // exactly once on mount, fresh entries fetch once — no imperative duplicate.
      invalidateRepoQueries(opened.path)
      startRepoRefresh(opened.path, generation, {
        clearLogOnStream: !cachedLog
      })
      return opened.path
    } catch (error) {
      if (generation !== openGeneration.current) {
        return null
      }
      setUi('error', formatCause(error))
      setUi('opening', false)
      return null
    }
  }

  const closeRepo = async () => {
    openGeneration.current++
    const repoPath = liveRepoPath.current
    if (repoPath) {
      try {
        await window.electronAPI.cancelLogStream(repoPath).catch(() => {})
        await window.electronAPI.closeRepo(repoPath)
      } catch {}
    }
    reset()
  }

  const resyncStatusAndDiffs = (context: StatusMutationContext) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: context.key }),
      invalidateDiffs(context.path)
    ])

  // Every mutation re-syncs status+diffs from the sidecar after it settles, success or failure.
  // On failure the optimistic write is first rolled back to the snapshot, but the snapshot can
  // itself be a concurrent same-file mutation's optimistic value (the rollback target is captured
  // in onMutate), so the authoritative refetch is what guarantees the cache converges — and it also
  // corrects a stale diff behind a HunkNotFound.
  const statusMutationOptions = <Vars,>(
    applyOptimistic: (current: GitStatus, vars: Vars) => GitStatus | null,
    request: (repoPath: string, vars: Vars) => Promise<StatusMutationResult>
  ) => ({
    mutationFn: async (vars: Vars): Promise<StatusMutationResult | null> => {
      const repoPath = liveRepoPath.current
      if (!repoPath) {
        return null
      }
      return request(repoPath, vars)
    },
    onMutate: async (vars: Vars): Promise<StatusMutationContext | undefined> => {
      const repoPath = liveRepoPath.current
      if (!repoPath) {
        return undefined
      }
      const key = repoQueryKeys(repoPath).status
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<GitStatus>(key)
      const optimistic = previous ? applyOptimistic(previous, vars) : null
      if (optimistic) {
        queryClient.setQueryData<GitStatus>(key, optimistic)
      }
      return { path: repoPath, key, previous, hadOptimistic: Boolean(optimistic) }
    },
    onError: (error: unknown, _vars: Vars, context: StatusMutationContext | undefined) => {
      if (context?.hadOptimistic && context.previous) {
        queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      setUi('error', formatCause(error))
      if (context) {
        return resyncStatusAndDiffs(context)
      }
      return undefined
    },
    onSuccess: (
      response: StatusMutationResult | null,
      _vars: Vars,
      context: StatusMutationContext | undefined
    ) => {
      if (!response || !context) {
        return undefined
      }
      if (response._tag === 'Ok') {
        return resyncStatusAndDiffs(context)
      }
      if (context.hadOptimistic && context.previous) {
        queryClient.setQueryData<GitStatus>(context.key, context.previous)
      }
      if (response._tag === 'GitError') {
        setUi('error', response.message)
      }
      return resyncStatusAndDiffs(context)
    }
  })

  const stageMutation = useMutation(
    statusMutationOptions<string>(
      (current, file) => applyStage(current, file),
      (repoPath, file) => rpcStageFile(repoPath, file)
    )
  )

  const unstageMutation = useMutation(
    statusMutationOptions<string>(
      (current, file) => applyUnstage(current, file),
      (repoPath, file) => rpcUnstageFile(repoPath, file)
    )
  )

  const stageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyStage(next, file), current),
      (repoPath, files) => rpcStageAll(repoPath, files)
    )
  )

  const unstageAllMutation = useMutation(
    statusMutationOptions<string[]>(
      (current, files) => files.reduce((next, file) => applyUnstage(next, file), current),
      (repoPath, files) => rpcUnstageAll(repoPath, files)
    )
  )

  interface HunkMutationVars {
    op: 'stage' | 'unstage'
    file: string
    hunkHeader: string
    options: HunkStageOptions
  }

  const hunkMutation = useMutation(
    statusMutationOptions<HunkMutationVars>(
      (current, vars) => {
        if (vars.op === 'stage' && vars.options.fullyStagesFile) {
          return applyStage(current, vars.file)
        }
        if (vars.op === 'unstage' && vars.options.fullyUnstagesFile) {
          return applyUnstage(current, vars.file)
        }
        return null
      },
      (repoPath, vars) =>
        vars.op === 'stage'
          ? rpcStageHunk(repoPath, vars.file, vars.hunkHeader)
          : rpcUnstageHunk(repoPath, vars.file, vars.hunkHeader)
    )
  )

  const commitMutation = useMutation({
    mutationFn: async (message: string) => {
      const repoPath = liveRepoPath.current
      if (!repoPath) {
        return false
      }
      setUi('committing', true)
      try {
        const response = await rpcCommit(repoPath, message)
        if (response._tag === 'Ok') {
          await Promise.all([refreshStatus(repoPath), invalidateDiffs(repoPath)])
          await restartLogStream(repoPath)
          return true
        }
        if (response._tag === 'GitError') {
          setUi('error', response.message)
        }
        return false
      } catch (error) {
        setUi('error', formatCause(error))
        return false
      } finally {
        setUi('committing', false)
      }
    }
  })

  useEffect(() => {
    if (tabActive && logBuffer.current.length > 0) {
      scheduleLogFlush()
    }
  })

  // The IPC subscription and unmount cleanup below register once (`[]` deps) and must read the
  // current helpers, not render-zero closures. The helpers are recreated each render, so the
  // subscription reads them through this ref (and the live repo through `liveRepoPath`).
  const latest = useRef({
    isTabActive: () => tabActiveRef.current,
    scheduleLogFlush,
    flushLogToStore,
    refreshStatus,
    refreshBranchesOnly,
    invalidateDiffs,
    invalidateStashes,
    restartLogStream,
    runFetchAndRefresh,
    openRepo
  })
  latest.current = {
    isTabActive: () => tabActiveRef.current,
    scheduleLogFlush,
    flushLogToStore,
    refreshStatus,
    refreshBranchesOnly,
    invalidateDiffs,
    invalidateStashes,
    restartLogStream,
    runFetchAndRefresh,
    openRepo
  }

  useEffect(() => {
    const unsubLog = window.electronAPI.onLogChunk((chunk) => {
      const { isTabActive, scheduleLogFlush, flushLogToStore } = latest.current
      if (chunk.repoPath !== liveRepoPath.current) {
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
        setUi('error', chunk.error)
      }
      if (chunk.done) {
        if (chunk.hasMore !== undefined) {
          setUi('logHasMore', chunk.hasMore)
        }
        setUi('logLoading', false)
        setUi('logLoadingMore', false)
        if (isTabActive()) {
          flushLogToStore(openGeneration.current, liveRepoPath.current)
        }
      }
    })

    const unsubChanged = window.electronAPI.onRepoChanged((event) => {
      const {
        refreshStatus,
        refreshBranchesOnly,
        invalidateDiffs,
        invalidateStashes,
        restartLogStream
      } = latest.current
      if (event.repoPath !== liveRepoPath.current) {
        return
      }
      const repoPath = event.repoPath
      if (event.kind === 'refs') {
        // External ref moves (CLI commit/rebase/amend, another GUI) change which commits are
        // reachable, so the graph must be re-streamed, not just relabelled. The watcher debounce
        // coalesces a multi-step rebase; the stream generation drops any old in-flight chunks.
        void refreshBranchesOnly(repoPath)
        void restartLogStream(repoPath)
      } else {
        void refreshStatus(repoPath)
        void invalidateDiffs(repoPath)
      }
      void invalidateStashes(repoPath)
    })

    const unsubRestarted = window.electronAPI.onSidecarRestarted(() => {
      const { openRepo, isTabActive } = latest.current
      const repoPath = liveRepoPath.current
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
      unsubChanged?.()
      unsubRestarted?.()
    }
  }, [setUi])

  const repoPathValue = ui.repoPath
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

  // The close is deferred a tick and cancelled when the effect re-runs so StrictMode's transient
  // mount→unmount→remount doesn't tear down the repo + log stream and bump the open generation.
  useEffect(() => {
    if (unmountCleanupTimer.current !== null) {
      clearTimeout(unmountCleanupTimer.current)
      unmountCleanupTimer.current = null
    }

    return () => {
      unmountCleanupTimer.current = setTimeout(() => {
        unmountCleanupTimer.current = null
        openGeneration.current++
        if (logFlushTimer.current !== null) {
          clearTimeout(logFlushTimer.current)
          logFlushTimer.current = null
        }
        logBuffer.current = []

        const repoPath = liveRepoPath.current
        if (!repoPath) {
          return
        }
        Promise.resolve(window.electronAPI.cancelLogStream(repoPath)).catch(() => {})
        Promise.resolve(window.electronAPI.closeRepo(repoPath)).catch(() => {})
      }, 0)
    }
  }, [])

  const fetchNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath) {
      return
    }
    setFetchTick((tick) => tick + 1)
    try {
      await runFetchAndRefresh(repoPath)
    } catch (error) {
      setUi('error', formatCause(error))
    }
  }

  const pushNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || ui.pushing) {
      return
    }
    setUi('pushing', true)
    try {
      const response = await rpcPush(repoPath)
      if (response._tag === 'Ok') {
        await refreshBranchesOnly(repoPath)
      } else if (response._tag === 'GitError') {
        setUi('error', response.message)
      }
    } catch (error) {
      setUi('error', formatCause(error))
    } finally {
      setUi('pushing', false)
    }
  }

  const pullNow = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || ui.pulling) {
      return
    }
    setUi('pulling', true)
    try {
      const response = await rpcPull(repoPath)
      if (response._tag === 'Ok') {
        await Promise.all([refreshStatus(repoPath), refreshBranchesOnly(repoPath)])
        await restartLogStream(repoPath)
      } else if (response._tag === 'GitError') {
        setUi('error', response.message)
      }
    } catch (error) {
      setUi('error', formatCause(error))
    } finally {
      setUi('pulling', false)
    }
  }

  return {
    state,
    loading: ui.opening || ui.committing,
    openRepo,
    closeRepo,
    stageFile: (file: string) => stageMutation.mutateAsync(file),
    unstageFile: (file: string) => unstageMutation.mutateAsync(file),
    stageAll: (files: string[]) => stageAllMutation.mutateAsync(files),
    unstageAll: (files: string[]) => unstageAllMutation.mutateAsync(files),
    stageHunk: (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      hunkMutation
        .mutateAsync({ op: 'stage', file, hunkHeader, options })
        .then((response) => response?._tag === 'Ok'),
    unstageHunk: (file: string, hunkHeader: string, options: HunkStageOptions = {}) =>
      hunkMutation
        .mutateAsync({ op: 'unstage', file, hunkHeader, options })
        .then((response) => response?._tag === 'Ok'),
    diffQueryKey: (file: string, staged: boolean) => {
      const repoPath = ui.repoPath
      return repoPath
        ? repoQueryKeys(repoPath).diff(file, staged)
        : (['repo', 'idle', tabId, 'diff', file, staged] as const)
    },
    commit: (message: string) => commitMutation.mutateAsync(message),
    fetchNow,
    pushNow,
    pullNow,
    refreshAfterCheckout,
    refreshAfterMutation,
    refreshWorkingTree,
    refreshBranchesOnly,
    refreshStashes: invalidateStashes,
    loadMoreHistory,
    invalidateRepoQueries
  }
}

export type GitStore = ReturnType<typeof useGitStore>
