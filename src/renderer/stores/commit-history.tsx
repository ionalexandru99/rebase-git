import { parseOrThrow } from '@shared/codec'
import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { StartLogStreamResponseSchema } from '@shared/schemas/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useLatestRef } from '@/hooks/useLatestRef'
import { repoQueryKeys } from '@/lib/query-keys'
import type { GitLog, GitLogEntry } from '@/types'
import type { OpenedRepo } from './repo-session'

const LOG_FLUSH_MS = 100
const WARM_REOPEN_GC_TIME_MS = 30 * 60 * 1000

const formatCause = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

interface LogUiState {
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
}

type SetLogUiState = {
  (next: Partial<LogUiState>): void
  <K extends keyof LogUiState>(key: K, value: LogUiState[K]): void
}

const initialLogUiState: LogUiState = {
  logLoading: false,
  logLoadingMore: false,
  logHasMore: false
}

interface RestartLogStreamOptions {
  clearLog?: boolean
  skip?: number
  maxCount?: number
}

export interface CommitHistoryDeps {
  repoPath: string | null
  tabId: string
  tabActive: boolean
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repoPath: string) => boolean
  setError: (error: string | null) => void
}

export interface CommitHistory {
  log: GitLog | null
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  loadMoreHistory: () => Promise<void>
}

export interface CommitHistoryController {
  log: GitLog | null
  logLoading: boolean
  logLoadingMore: boolean
  logHasMore: boolean
  value: CommitHistory
  restart: (repoPath: string, options?: RestartLogStreamOptions) => Promise<void>
  onRepoOpened: (opened: OpenedRepo, generation: number) => void
  cancelStream: (repoPath: string) => Promise<void>
  reset: () => void
}

export function useCommitHistoryController(deps: CommitHistoryDeps): CommitHistoryController {
  const queryClient = useQueryClient()
  const { repoPath, tabId, tabActive, liveRepoPath, openGenerationRef, isCurrentRepo, setError } =
    deps

  const [logUi, setLogUiState] = useState<LogUiState>({ ...initialLogUiState })
  const setLogUi = useCallback(
    ((keyOrNext: keyof LogUiState | Partial<LogUiState>, value?: unknown) => {
      setLogUiState((previous) => {
        if (typeof keyOrNext === 'string') {
          if (Object.is(previous[keyOrNext], value)) {
            return previous
          }
          return { ...previous, [keyOrNext]: value }
        }
        return { ...previous, ...keyOrNext }
      })
    }) as SetLogUiState,
    []
  )

  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const logBuffer = useRef<GitLogEntry[]>([])
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logStreamSeq = useRef(0)

  // The log is push-based: chunks arrive over IPC and are written into the Query cache via
  // setQueryData. This disabled query subscribes the component to those cache writes — it never
  // fetches on its own.
  const logQuery = useQuery({
    queryKey: repoQueryKeys(repoPath, { idle: tabId }).log,
    enabled: false,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: () => Promise.resolve<GitLog | null>(null)
  })

  const flushLogToStore = (expectedGen: number, expectedPath: string | null) => {
    logFlushTimer.current = null
    if (expectedGen !== openGenerationRef.current || expectedPath !== liveRepoPath.current) {
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
    const expectedGen = openGenerationRef.current
    const expectedPath = liveRepoPath.current
    logFlushTimer.current = setTimeout(() => {
      // While inactive, drop the timer and let the tabActive effect reschedule on activation —
      // rescheduling here would busy-poll a fresh timer every LOG_FLUSH_MS until the tab returns.
      if (!tabActiveRef.current) {
        logFlushTimer.current = null
        return
      }
      flushLogToStore(expectedGen, expectedPath)
    }, LOG_FLUSH_MS)
  }

  const restart = async (repoPath: string, options?: RestartLogStreamOptions) => {
    const generation = openGenerationRef.current
    if (!isCurrentRepo(generation, repoPath)) {
      return
    }
    const skip = options?.skip ?? 0
    const maxCount = options?.maxCount ?? LOG_PAGE_SIZE
    const append = skip > 0
    const clearLog = options?.clearLog ?? !append

    // Stamp this start so in-flight chunks from a previous stream (same repoPath, older id) are
    // dropped by onLogChunk instead of landing in the freshly-cleared buffer. The same stamp guards
    // the response below: a newer restart (same repo, same generation) supersedes this one, so its
    // late success/failure must not clear loading or report a stale error over the newer stream.
    const streamId = ++logStreamSeq.current
    const isLatestStream = () => streamId === logStreamSeq.current

    if (!append) {
      logBuffer.current = []
      if (clearLog) {
        queryClient.setQueryData<GitLog>(repoQueryKeys(repoPath).log, { all: [], total: 0 })
        setLogUi('logHasMore', false)
      }
      setLogUi({ logLoading: true, logLoadingMore: false })
    } else {
      setLogUi({ logLoading: false, logLoadingMore: true })
    }

    try {
      await window.electronAPI.cancelLogStream(repoPath).catch(() => {})
      const response = parseOrThrow(
        StartLogStreamResponseSchema,
        await window.electronAPI.startLogStream(repoPath, { skip, maxCount, streamId })
      )
      if (!isCurrentRepo(generation, repoPath) || !isLatestStream()) {
        return
      }
      if (response._tag === 'GitError') {
        setError(response.message)
        setLogUi({ logLoading: false, logLoadingMore: false })
      }
    } catch (error) {
      if (!isCurrentRepo(generation, repoPath) || !isLatestStream()) {
        return
      }
      setError(formatCause(error))
      setLogUi({ logLoading: false, logLoadingMore: false })
    }
  }

  const loadMoreImpl = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || !logUi.logHasMore || logUi.logLoadingMore || logUi.logLoading) {
      return
    }
    // The cache holds the last throttled flush; the buffer may already hold more commits still
    // draining in. Skipping by the smaller of the two would re-request buffered commits or gap.
    const cached = queryClient.getQueryData<GitLog>(repoQueryKeys(repoPath).log)
    const skip = Math.max(logBuffer.current.length, cached?.all.length ?? 0)
    await restart(repoPath, { skip, maxCount: LOG_PAGE_SIZE, clearLog: false })
  }

  const loadMoreRef = useRef(loadMoreImpl)
  loadMoreRef.current = loadMoreImpl
  const loadMoreHistory = useCallback(() => loadMoreRef.current(), [])

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
      setError(formatCause(error))
    })
  }

  const onRepoOpened = (opened: OpenedRepo, generation: number) => {
    const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(opened.path).log)
    setLogUi({ logLoading: false, logLoadingMore: false, logHasMore: false })
    logBuffer.current = cachedLog?.all ? [...cachedLog.all] : []
    runIfCurrent(generation, opened.path, 'restartLogStream', async () => {
      await restart(opened.path, { clearLog: !cachedLog })
    })
  }

  const cancelStream = (repoPath: string) =>
    Promise.resolve(window.electronAPI.cancelLogStream(repoPath))
      .then(() => undefined)
      .catch(() => {})

  const reset = () => {
    logBuffer.current = []
    if (logFlushTimer.current !== null) {
      clearTimeout(logFlushTimer.current)
      logFlushTimer.current = null
    }
    setLogUi({ ...initialLogUiState })
  }

  useEffect(() => {
    if (tabActive && logBuffer.current.length > 0) {
      scheduleLogFlush()
    }
  })

  // The IPC subscription below registers once (`[]` deps) and must read the current helpers, not
  // render-zero closures. The helpers are recreated each render, so it reads them through this ref.
  const latest = useLatestRef({
    getOpenGeneration: () => openGenerationRef.current,
    getRepoPath: () => liveRepoPath.current,
    isTabActive: () => tabActiveRef.current,
    setError,
    scheduleLogFlush,
    flushLogToStore
  })

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
          setLogUi('logHasMore', chunk.hasMore)
        }
        setLogUi('logLoading', false)
        setLogUi('logLoadingMore', false)
        if (isTabActive()) {
          flushLogToStore(getOpenGeneration(), getRepoPath())
        }
      }
    })
    return () => {
      unsubLog?.()
    }
  }, [setLogUi])

  const log = logQuery.data ?? null

  const value = useMemo<CommitHistory>(
    () => ({
      log,
      logLoading: logUi.logLoading,
      logLoadingMore: logUi.logLoadingMore,
      logHasMore: logUi.logHasMore,
      loadMoreHistory
    }),
    [log, logUi.logLoading, logUi.logLoadingMore, logUi.logHasMore, loadMoreHistory]
  )

  return {
    log,
    logLoading: logUi.logLoading,
    logLoadingMore: logUi.logLoadingMore,
    logHasMore: logUi.logHasMore,
    value,
    restart,
    onRepoOpened,
    cancelStream,
    reset
  }
}

const CommitHistoryContext = createContext<CommitHistory | null>(null)

export const CommitHistoryProvider = CommitHistoryContext.Provider

export function useCommitHistory(): CommitHistory {
  const value = useContext(CommitHistoryContext)
  if (!value) {
    throw new Error('useCommitHistory must be used within a GitStoreProvider')
  }
  return value
}
