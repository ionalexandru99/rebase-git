import { parseOrThrow } from '@shared/codec'
import { LOG_PAGE_SIZE } from '@shared/graph-config'
import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
import {
  BranchesResponseSchema,
  CommitResponseSchema,
  FetchResponseSchema,
  LocalBranchesResponseSchema,
  OpenRepoResponseSchema,
  RemoteRefsResponseSchema,
  StageResponseSchema,
  StartLogStreamResponseSchema,
  StatusResponseSchema,
  UnstageResponseSchema
} from '@shared/schemas/ipc'
import { SidecarOp } from '@shared/sidecar-ops'
import { useEffect, useRef } from 'react'
import { repoQueryKeys } from '@/lib/query-keys'
import { type Accessor, batch, createSignal } from '@/lib/react-compat'
import { createMutation, createQuery, useQueryClient } from '@/lib/react-query-compat'
import { createStore } from '@/lib/react-store-compat'
import { readSnapshot, writeSnapshot } from '@/lib/repo-snapshot-cache'
import { sidecarFetch } from '@/lib/sidecar-fetch'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000
const LOG_FLUSH_MS = 100

const mergeBranches = (existing: GitBranches | null, patch: Partial<GitBranches>): GitBranches => {
  const next = {
    current: patch.current ?? existing?.current ?? '',
    all: patch.all ?? existing?.all ?? [],
    remotes: patch.remotes ?? existing?.remotes ?? [],
    tags: patch.tags ?? existing?.tags ?? [],
    tracking: patch.tracking ?? existing?.tracking
  }
  if (
    existing &&
    existing.current === next.current &&
    existing.all === next.all &&
    existing.remotes === next.remotes &&
    existing.tags === next.tags &&
    existing.tracking === next.tracking
  ) {
    return existing
  }
  return next
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
  statusLoading: boolean
  branchesLoading: boolean
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  error: string | null
}

const initialState: GitState = {
  repoPath: null,
  status: null,
  log: null,
  branches: null,
  remotes: {},
  defaultBranch: undefined,
  currentBranch: '',
  opening: false,
  committing: false,
  statusLoading: false,
  branchesLoading: false,
  logLoading: false,
  logLoadingMore: false,
  logHasMore: false,
  error: null
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

const isInvalidSidecarRequest = (error: unknown): boolean => {
  return formatCause(error).includes('invalid sidecar request')
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
  try {
    const response = await sidecarFetch(
      SidecarOp.getLocalBranches,
      { repoPath: path },
      LocalBranchesResponseSchema
    )
    return parseLocalBranchesResponse(response)
  } catch (error) {
    if (!isInvalidSidecarRequest(error)) {
      throw error
    }
    const response = await sidecarFetch(
      SidecarOp.getBranches,
      { repoPath: path },
      BranchesResponseSchema
    )
    if (response._tag === 'Ok') {
      return {
        current: response.branches.current,
        all: response.branches.all,
        tracking: response.branches.tracking
      }
    }
    return parseLocalBranchesResponse(response)
  }
}

const fetchRemoteRefs = async (path: string): Promise<RemoteRefs> => {
  try {
    const response = await sidecarFetch(
      SidecarOp.getRemoteRefs,
      { repoPath: path },
      RemoteRefsResponseSchema
    )
    return parseRemoteRefsResponse(response)
  } catch (error) {
    if (!isInvalidSidecarRequest(error)) {
      throw error
    }
    const response = await sidecarFetch(
      SidecarOp.getBranches,
      { repoPath: path },
      BranchesResponseSchema
    )
    if (response._tag === 'Ok') {
      return {
        remotes: response.branches.remotes,
        tags: response.branches.tags
      }
    }
    return parseRemoteRefsResponse(response)
  }
}

const withoutFile = (files: string[], file: string): string[] => files.filter((f) => f !== file)
const withFile = (files: string[], file: string): string[] =>
  files.includes(file) ? files : [...files, file]

const applyStage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withFile(status.staged, file),
  modified: withoutFile(status.modified, file),
  not_added: withoutFile(status.not_added, file),
  created: withoutFile(status.created, file),
  deleted: withoutFile(status.deleted, file)
})

const applyUnstage = (status: GitStatus, file: string): GitStatus => ({
  ...status,
  staged: withoutFile(status.staged, file),
  modified: withFile(status.modified, file)
})

export function useGitStore(tabId: string, tabActive: Accessor<boolean>) {
  const queryClient = useQueryClient()
  const [state, setState] = createStore<GitState>({ ...initialState })
  const [fetchTick, setFetchTick] = createSignal(0)

  const logBuffer = useRef<GitLogEntry[]>([])
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openGeneration = useRef(0)

  const flushLogToStore = (expectedGen: number, expectedPath: string | null) => {
    logFlushTimer.current = null
    if (expectedGen !== openGeneration.current || expectedPath !== state.repoPath) {
      return
    }
    const nextLength = logBuffer.current.length
    const previous = state.log?.all ?? []
    if (nextLength === previous.length && state.log?.total === nextLength) {
      return
    }

    if (previous.length === 0 || nextLength < previous.length) {
      setState('log', { all: [...logBuffer.current], total: nextLength })
    } else {
      batch(() => {
        for (let index = previous.length; index < nextLength; index++) {
          setState('log', 'all', index, logBuffer.current[index])
        }
        setState('log', 'total', nextLength)
      })
    }

    const path = state.repoPath
    if (path) {
      const log = state.log
      if (log) {
        queryClient.setQueryData(repoQueryKeys(tabId, path).log, log)
        writeSnapshot(path, { log })
      }
    }
  }

  const scheduleLogFlush = () => {
    if (logFlushTimer.current !== null) {
      return
    }
    const expectedGen = openGeneration.current
    const expectedPath = state.repoPath
    logFlushTimer.current = setTimeout(() => {
      if (!tabActive()) {
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
    setState({ ...initialState })
  }

  const repoPath = () => state.repoPath
  const keys = () => {
    const path = repoPath()
    return path ? repoQueryKeys(tabId, path) : null
  }

  const statusQuery = createQuery(() => {
    const path = repoPath()
    const queryKeys = keys()
    return {
      queryKey: queryKeys?.status ?? ['tab', tabId, 'idle', 'status'],
      enabled: Boolean(path),
      queryFn: async () => {
        if (!path) {
          throw new Error('Repository path missing')
        }
        const response = await sidecarFetch('get-status', { repoPath: path }, StatusResponseSchema)
        if (response._tag === 'Ok') {
          return response.status
        }
        if (response._tag === 'GitError') {
          throw new Error(response.message)
        }
        throw new Error('Repository not open')
      }
    }
  })

  const localBranchesQuery = createQuery(() => {
    const path = repoPath()
    const queryKeys = keys()
    return {
      queryKey: queryKeys?.localBranches ?? ['tab', tabId, 'idle', 'local-branches'],
      enabled: Boolean(path),
      queryFn: async () => {
        if (!path) {
          throw new Error('Repository path missing')
        }
        return fetchLocalBranches(path)
      }
    }
  })

  const remoteRefsQuery = createQuery(() => {
    const path = repoPath()
    const queryKeys = keys()
    const localReady = Boolean(localBranchesQuery.data)
    return {
      queryKey: queryKeys?.remoteRefs ?? ['tab', tabId, 'idle', 'remote-refs'],
      enabled: Boolean(path) && localReady,
      queryFn: async () => {
        if (!path) {
          throw new Error('Repository path missing')
        }
        return fetchRemoteRefs(path)
      }
    }
  })

  useEffect(() => {
    const data = statusQuery.data
    if (data) {
      setState('status', data)
      setState('currentBranch', data.current)
      const path = repoPath()
      if (path) {
        writeSnapshot(path, { status: data, currentBranch: data.current })
      }
    }
    setState('statusLoading', statusQuery.isFetching && !statusQuery.data)
  }, [statusQuery.data, statusQuery.isFetching, state.repoPath])

  useEffect(() => {
    const error = statusQuery.error
    if (error) {
      setState('error', formatCause(error))
    }
  }, [statusQuery.error])

  useEffect(() => {
    const data = localBranchesQuery.data
    if (data) {
      setState('branches', (previous: GitBranches | null) => mergeBranches(previous, data))
      if (data.current) {
        setState('currentBranch', data.current)
      }
      const path = repoPath()
      if (path) {
        writeSnapshot(path, {
          branches: mergeBranches(readSnapshot(path)?.branches ?? null, data)
        })
      }
    }
    setState('branchesLoading', localBranchesQuery.isFetching && !localBranchesQuery.data)
  }, [localBranchesQuery.data, localBranchesQuery.isFetching, state.repoPath])

  useEffect(() => {
    const error = localBranchesQuery.error
    if (error) {
      setState('error', formatCause(error))
    }
  }, [localBranchesQuery.error])

  useEffect(() => {
    const data = remoteRefsQuery.data
    if (data) {
      setState('branches', (previous: GitBranches | null) => mergeBranches(previous, data))
      const path = repoPath()
      if (path) {
        writeSnapshot(path, {
          branches: mergeBranches(readSnapshot(path)?.branches ?? null, data)
        })
      }
    }
  }, [remoteRefsQuery.data, state.repoPath])

  useEffect(() => {
    const error = remoteRefsQuery.error
    if (error) {
      setState('error', formatCause(error))
    }
  }, [remoteRefsQuery.error])

  useEffect(() => {
    if (tabActive() && logBuffer.current.length > 0) {
      scheduleLogFlush()
    }
  })

  const invalidateRepoQueries = (path: string) => {
    const queryKeys = repoQueryKeys(tabId, path)
    void queryClient.invalidateQueries({ queryKey: queryKeys.status })
    void queryClient.invalidateQueries({ queryKey: queryKeys.localBranches })
    void queryClient.invalidateQueries({ queryKey: queryKeys.remoteRefs })
  }

  const applyLocalBranches = (path: string, local: LocalBranches) => {
    setState('branches', (previous: GitBranches | null) => mergeBranches(previous, local))
    if (local.current) {
      setState('currentBranch', local.current)
    }
    const branches = mergeBranches(readSnapshot(path)?.branches ?? null, local)
    queryClient.setQueryData(repoQueryKeys(tabId, path).localBranches, local)
    writeSnapshot(path, { branches })
  }

  const refreshLocalBranches = async (path: string) => {
    const local = await fetchLocalBranches(path)
    applyLocalBranches(path, local)
  }

  const refreshBranchesOnly = async (path: string) => {
    await refreshLocalBranches(path)
    const queryKeys = repoQueryKeys(tabId, path)
    void queryClient.invalidateQueries({ queryKey: queryKeys.remoteRefs })
  }

  const refreshAfterCheckout = async (path: string) => {
    const queryKeys = repoQueryKeys(tabId, path)
    await Promise.all([
      queryClient.cancelQueries({ queryKey: queryKeys.status }),
      queryClient.cancelQueries({ queryKey: queryKeys.localBranches })
    ])
    await Promise.all([refreshStatus(path), refreshBranchesOnly(path)])
  }

  const refreshStatus = async (path: string) => {
    const response = await sidecarFetch('get-status', { repoPath: path }, StatusResponseSchema)
    if (response._tag === 'Ok') {
      setState('status', response.status)
      setState('currentBranch', response.status.current)
      queryClient.setQueryData(repoQueryKeys(tabId, path).status, response.status)
      writeSnapshot(path, { status: response.status, currentBranch: response.status.current })
      return
    }
    if (response._tag === 'GitError') {
      throw new Error(response.message)
    }
    throw new Error('Repository not open')
  }

  const restartLogStream = async (
    path: string,
    options?: { clearLog?: boolean; skip?: number; maxCount?: number }
  ) => {
    const skip = options?.skip ?? 0
    const maxCount = options?.maxCount ?? LOG_PAGE_SIZE
    const append = skip > 0
    const clearLog = options?.clearLog ?? !append

    if (!append) {
      logBuffer.current = []
      if (clearLog) {
        setState('log', { all: [], total: 0 })
        setState('logHasMore', false)
      }
      setState('logLoading', true)
    } else {
      setState('logLoadingMore', true)
    }

    try {
      await window.electronAPI.cancelLogStream(path).catch(() => {})
      const response = parseOrThrow(
        StartLogStreamResponseSchema,
        await window.electronAPI.startLogStream(path, { skip, maxCount })
      )
      if (response._tag === 'GitError') {
        setState('error', response.message)
        if (append) {
          setState('logLoadingMore', false)
        } else {
          setState('logLoading', false)
        }
      }
    } catch (error) {
      setState('error', formatCause(error))
      if (append) {
        setState('logLoadingMore', false)
      } else {
        setState('logLoading', false)
      }
    }
  }

  const loadMoreHistory = async () => {
    const path = state.repoPath
    if (!path || !state.logHasMore || state.logLoadingMore || state.logLoading) {
      return
    }
    const skip = state.log?.all.length ?? logBuffer.current.length
    await restartLogStream(path, { skip, maxCount: LOG_PAGE_SIZE, clearLog: false })
  }

  const runFetchAndRefresh = async (path: string) => {
    const response = await sidecarFetch('fetch-repo', { repoPath: path }, FetchResponseSchema)
    if (response._tag === 'Ok' && tabActive()) {
      await refreshBranchesOnly(path)
    } else if (response._tag === 'GitError') {
      setState('error', response.message)
    }
  }

  const runIfCurrent = (
    generation: number,
    path: string,
    label: string,
    task: () => Promise<void>
  ) => {
    void task().catch((error: unknown) => {
      if (generation !== openGeneration.current || state.repoPath !== path) {
        return
      }
      console.error(`[git] ${label} failed for ${path}:`, formatCause(error))
      setState('error', formatCause(error))
    })
  }

  const startRepoRefresh = (
    path: string,
    generation: number,
    options?: { clearLogOnStream?: boolean }
  ) => {
    runIfCurrent(generation, path, 'refreshStatus', async () => {
      await refreshStatus(path)
    })

    runIfCurrent(generation, path, 'refreshLocalBranches', async () => {
      await refreshLocalBranches(path)
    })

    runIfCurrent(generation, path, 'restartLogStream', async () => {
      await restartLogStream(path, { clearLog: options?.clearLogOnStream ?? true })
    })
  }

  const openRepo = async (path: string) => {
    const generation = ++openGeneration.current
    setState('opening', true)
    setState('error', null)

    try {
      const openResponse = parseOrThrow(
        OpenRepoResponseSchema,
        await window.electronAPI.openRepo(path)
      )
      if (generation !== openGeneration.current) {
        return
      }

      if (openResponse._tag !== 'Ok') {
        const errorMessage =
          openResponse._tag === 'NotARepo' ? 'Not a git repository' : openResponse.message
        setState('error', errorMessage)
        setState('opening', false)
        return
      }

      const opened = openResponse.result
      writeSnapshot(opened.path, {
        remotes: opened.remotes,
        defaultBranch: opened.defaultBranch
      })
      const cached = readSnapshot(opened.path)

      setState({
        repoPath: opened.path,
        remotes: opened.remotes,
        defaultBranch: opened.defaultBranch,
        currentBranch: cached?.status?.current ?? cached?.currentBranch ?? '',
        status: cached?.status ?? null,
        branches: cached?.branches ?? null,
        log: cached?.log ?? null,
        opening: false,
        statusLoading: !cached?.status,
        branchesLoading: !cached?.branches?.all?.length,
        logLoading: false
      })

      if (cached?.log?.all) {
        logBuffer.current = [...cached.log.all]
      }

      startRepoRefresh(opened.path, generation, { clearLogOnStream: !cached?.log })
    } catch (error) {
      if (generation !== openGeneration.current) {
        return
      }
      setState('error', formatCause(error))
      setState('opening', false)
      setState({ statusLoading: false, branchesLoading: false, logLoading: false })
    }
  }

  const closeRepo = async () => {
    openGeneration.current++
    const path = state.repoPath
    if (path) {
      try {
        await window.electronAPI.cancelLogStream(path).catch(() => {})
        await window.electronAPI.closeRepo(path)
      } catch {}
    }
    reset()
  }

  const stageMutation = createMutation(() => ({
    mutationFn: async (file: string) => {
      const path = repoPath()
      if (!path) {
        return
      }
      const previous = readSnapshot(path)?.status
      if (previous) {
        const optimistic = applyStage(previous, file)
        writeSnapshot(path, { status: optimistic })
        setState('status', optimistic)
      }
      const response = await sidecarFetch(
        'stage-file',
        { repoPath: path, file },
        StageResponseSchema
      )
      if (response._tag === 'Ok') {
        await refreshStatus(path)
        return
      }
      if (previous) {
        writeSnapshot(path, { status: previous })
        setState('status', previous)
      }
      if (response._tag === 'GitError') {
        setState('error', response.message)
      }
    }
  }))

  const unstageMutation = createMutation(() => ({
    mutationFn: async (file: string) => {
      const path = repoPath()
      if (!path) {
        return
      }
      const previous = readSnapshot(path)?.status
      if (previous) {
        const optimistic = applyUnstage(previous, file)
        writeSnapshot(path, { status: optimistic })
        setState('status', optimistic)
      }
      const response = await sidecarFetch(
        'unstage-file',
        { repoPath: path, file },
        UnstageResponseSchema
      )
      if (response._tag === 'Ok') {
        await refreshStatus(path)
        return
      }
      if (previous) {
        writeSnapshot(path, { status: previous })
        setState('status', previous)
      }
      if (response._tag === 'GitError') {
        setState('error', response.message)
      }
    }
  }))

  const commitMutation = createMutation(() => ({
    mutationFn: async (message: string) => {
      const path = repoPath()
      if (!path) {
        return false
      }
      setState('committing', true)
      try {
        const response = await sidecarFetch(
          'commit',
          { repoPath: path, message },
          CommitResponseSchema
        )
        if (response._tag === 'Ok') {
          await refreshStatus(path)
          await restartLogStream(path)
          return true
        }
        if (response._tag === 'GitError') {
          setState('error', response.message)
        }
        return false
      } catch (error) {
        setState('error', formatCause(error))
        return false
      } finally {
        setState('committing', false)
      }
    }
  }))

  useEffect(() => {
    const unsubLog = window.electronAPI.onLogChunk((chunk) => {
      if (chunk.repoPath !== state.repoPath) {
        return
      }
      if (chunk.commits.length > 0) {
        for (const commit of chunk.commits) {
          logBuffer.current.push(commit)
        }
        scheduleLogFlush()
      }
      if (chunk.error) {
        setState('error', chunk.error)
      }
      if (chunk.done) {
        if (chunk.hasMore !== undefined) {
          setState('logHasMore', chunk.hasMore)
        }
        setState('logLoading', false)
        setState('logLoadingMore', false)
        if (tabActive()) {
          flushLogToStore(openGeneration.current, state.repoPath)
        }
      }
    })

    const unsubChanged = window.electronAPI.onRepoChanged((event) => {
      if (event.repoPath !== state.repoPath) {
        return
      }
      const path = event.repoPath
      if (event.kind === 'refs') {
        void refreshBranchesOnly(path)
      } else {
        void refreshStatus(path)
      }
    })

    return () => {
      unsubLog?.()
      unsubChanged?.()
    }
  }, [])

  useEffect(() => {
    const path = state.repoPath
    fetchTick()
    if (!path || !tabActive()) {
      return
    }
    const handle = window.setInterval(() => {
      if (tabActive()) {
        void runFetchAndRefresh(path)
      }
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  })

  useEffect(() => {
    return () => {
      openGeneration.current++
      if (logFlushTimer.current !== null) {
        clearTimeout(logFlushTimer.current)
        logFlushTimer.current = null
      }
      logBuffer.current = []
      setState('log', null)

      const path = state.repoPath
      if (!path) {
        return
      }
      setTimeout(() => {
        Promise.resolve(window.electronAPI.cancelLogStream(path)).catch(() => {})
        Promise.resolve(window.electronAPI.closeRepo(path)).catch(() => {})
      }, 0)
    }
  }, [])

  const fetchNow = async () => {
    const path = state.repoPath
    if (!path) {
      return
    }
    setFetchTick((tick) => tick + 1)
    try {
      await runFetchAndRefresh(path)
    } catch (error) {
      setState('error', formatCause(error))
    }
  }

  return {
    state,
    loading: () => state.opening || state.committing,
    openRepo,
    closeRepo,
    stageFile: (file: string) => stageMutation.mutateAsync(file),
    unstageFile: (file: string) => unstageMutation.mutateAsync(file),
    commit: (message: string) => commitMutation.mutateAsync(message),
    fetchNow,
    refreshAfterCheckout,
    loadMoreHistory,
    invalidateRepoQueries
  }
}

export type GitStore = ReturnType<typeof useGitStore>
