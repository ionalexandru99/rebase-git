import { parseOrThrow } from '@shared/codec'
import {
  BranchesResponseSchema,
  CommitResponseSchema,
  FetchResponseSchema,
  LogResponseSchema,
  OpenRepoResponseSchema,
  StageResponseSchema,
  StartLogStreamResponseSchema,
  StatusResponseSchema,
  UnstageResponseSchema
} from '@shared/schemas/ipc'
import { createMutation, createQuery, useQueryClient } from '@tanstack/solid-query'
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'
import { repoQueryKeys } from '@/lib/query-keys'
import { hasCachedData, readSnapshot, writeSnapshot } from '@/lib/repo-snapshot-cache'
import { LOG_REFRESH_MAX_COUNT, sidecarFetch } from '@/lib/sidecar-fetch'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

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

  let logBuffer: GitLogEntry[] = []
  let logFlushRaf: number | null = null
  let openGeneration = 0

  const flushLogToStore = () => {
    logFlushRaf = null
    const log: GitLog = { all: logBuffer, total: logBuffer.length }
    setState('log', log)
    const path = state.repoPath
    if (path) {
      queryClient.setQueryData(repoQueryKeys(tabId, path).log, log)
      writeSnapshot(path, { log })
    }
  }

  const scheduleLogFlush = () => {
    if (logFlushRaf !== null) {
      return
    }
    logFlushRaf = requestAnimationFrame(flushLogToStore)
  }

  const reset = () => {
    logBuffer = []
    if (logFlushRaf !== null) {
      cancelAnimationFrame(logFlushRaf)
      logFlushRaf = null
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
      enabled: Boolean(path && tabActive()),
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

  const branchesQuery = createQuery(() => {
    const path = repoPath()
    const queryKeys = keys()
    return {
      queryKey: queryKeys?.branches ?? ['tab', tabId, 'idle', 'branches'],
      enabled: Boolean(path && tabActive()),
      queryFn: async () => {
        if (!path) {
          throw new Error('Repository path missing')
        }
        const response = await sidecarFetch(
          'get-branches',
          { repoPath: path },
          BranchesResponseSchema
        )
        if (response._tag === 'Ok') {
          return response.branches
        }
        if (response._tag === 'GitError') {
          throw new Error(response.message)
        }
        throw new Error('Repository not open')
      }
    }
  })

  createEffect(() => {
    const data = statusQuery.data
    if (data) {
      setState('status', data)
      setState('currentBranch', data.current)
      const path = repoPath()
      if (path) {
        writeSnapshot(path, { status: data, currentBranch: data.current })
      }
    }
    setState('statusLoading', statusQuery.isFetching)
  })

  createEffect(() => {
    const data = branchesQuery.data
    if (data) {
      setState('branches', data)
      if (data.current) {
        setState('currentBranch', data.current)
      }
      const path = repoPath()
      if (path) {
        writeSnapshot(path, { branches: data })
      }
    }
    setState('branchesLoading', branchesQuery.isFetching)
  })

  const invalidateRepoQueries = (path: string) => {
    const queryKeys = repoQueryKeys(tabId, path)
    void queryClient.invalidateQueries({ queryKey: queryKeys.status })
    void queryClient.invalidateQueries({ queryKey: queryKeys.branches })
  }

  const refreshBranchesOnly = async (path: string) => {
    const queryKeys = repoQueryKeys(tabId, path)
    await queryClient.fetchQuery({
      queryKey: queryKeys.branches,
      queryFn: async () => {
        const response = await sidecarFetch(
          'get-branches',
          { repoPath: path },
          BranchesResponseSchema
        )
        if (response._tag === 'Ok') {
          writeSnapshot(path, { branches: response.branches })
          return response.branches
        }
        if (response._tag === 'GitError') {
          throw new Error(response.message)
        }
        throw new Error('Repository not open')
      }
    })
  }

  const refreshStatus = async (path: string) => {
    const queryKeys = repoQueryKeys(tabId, path)
    await queryClient.fetchQuery({
      queryKey: queryKeys.status,
      queryFn: async () => {
        const response = await sidecarFetch('get-status', { repoPath: path }, StatusResponseSchema)
        if (response._tag === 'Ok') {
          writeSnapshot(path, { status: response.status, currentBranch: response.status.current })
          return response.status
        }
        if (response._tag === 'GitError') {
          throw new Error(response.message)
        }
        throw new Error('Repository not open')
      }
    })
  }

  const refreshLogLimited = async (path: string) => {
    const response = await sidecarFetch(
      'get-log',
      { repoPath: path, maxCount: LOG_REFRESH_MAX_COUNT },
      LogResponseSchema
    )
    if (response._tag === 'Ok') {
      logBuffer = [...response.log.all]
      writeSnapshot(path, { log: response.log })
      flushLogToStore()
    }
  }

  const restartLogStream = async (path: string) => {
    logBuffer = []
    setState('log', { all: [], total: 0 })
    setState('logLoading', true)
    try {
      await window.electronAPI.cancelLogStream(path).catch(() => {})
      const response = parseOrThrow(
        StartLogStreamResponseSchema,
        await window.electronAPI.startLogStream(path)
      )
      if (response._tag === 'GitError') {
        setState('error', response.message)
        setState('logLoading', false)
      }
    } catch (error) {
      setState('error', formatCause(error))
      setState('logLoading', false)
    }
  }

  const runFetchAndRefresh = async (path: string) => {
    const response = await sidecarFetch('fetch-repo', { repoPath: path }, FetchResponseSchema)
    if (response._tag === 'Ok' && tabActive()) {
      await refreshBranchesOnly(path)
    }
  }

  const openRepo = async (path: string) => {
    const generation = ++openGeneration
    setState('opening', true)
    setState('error', null)

    try {
      const openResponse = parseOrThrow(
        OpenRepoResponseSchema,
        await window.electronAPI.openRepo(path)
      )
      if (generation !== openGeneration) {
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
        opening: false
      })

      if (hasCachedData(cached)) {
        if (cached?.status) {
          setState('status', cached.status)
          setState('currentBranch', cached.status.current)
        }
        if (cached?.branches) {
          setState('branches', cached.branches)
        }
        if (cached?.log) {
          logBuffer = [...(cached.log.all ?? [])]
          setState('log', cached.log)
        }
        setState({ statusLoading: false, branchesLoading: false, logLoading: false })
        void Promise.all([
          refreshStatus(opened.path),
          refreshBranchesOnly(opened.path),
          refreshLogLimited(opened.path)
        ])
        return
      }

      setState({
        statusLoading: true,
        branchesLoading: true,
        status: null,
        branches: null
      })
      await Promise.all([
        restartLogStream(opened.path),
        refreshStatus(opened.path),
        refreshBranchesOnly(opened.path)
      ])
    } catch (error) {
      if (generation !== openGeneration) {
        return
      }
      setState('error', formatCause(error))
      setState('opening', false)
      setState({ statusLoading: false, branchesLoading: false, logLoading: false })
    }
  }

  const closeRepo = async () => {
    openGeneration++
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

  const unsubLog = window.electronAPI.onLogChunk((chunk) => {
    if (!tabActive()) {
      return
    }
    if (chunk.repoPath !== state.repoPath) {
      return
    }
    if (chunk.commits.length > 0) {
      for (const commit of chunk.commits) {
        logBuffer.push(commit)
      }
      scheduleLogFlush()
    }
    if (chunk.error) {
      setState('error', chunk.error)
    }
    if (chunk.done) {
      setState('logLoading', false)
    }
  })

  const unsubChanged = window.electronAPI.onRepoChanged((event) => {
    if (!tabActive()) {
      return
    }
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

  createEffect(() => {
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
    onCleanup(() => window.clearInterval(handle))
  })

  onCleanup(() => {
    openGeneration++
    if (logFlushRaf !== null) {
      cancelAnimationFrame(logFlushRaf)
    }
    unsubLog?.()
    unsubChanged?.()
    const path = state.repoPath
    if (path) {
      Promise.resolve(window.electronAPI.cancelLogStream(path)).catch(() => {})
      Promise.resolve(window.electronAPI.closeRepo(path)).catch(() => {})
    }
  })

  const fetchNow = async () => {
    const path = state.repoPath
    if (!path) {
      return
    }
    setFetchTick((tick) => tick + 1)
    await runFetchAndRefresh(path)
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
    invalidateRepoQueries
  }
}

export type GitStore = ReturnType<typeof useGitStore>
