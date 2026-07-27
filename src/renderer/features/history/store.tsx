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
import { formatCause } from '@/lib/format-cause'
import { gitFailureBannerText } from '@/lib/git-failure'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { repoQueryKeys } from '@/lib/query-keys'
import type { GitLog, GitLogEntry } from '@/types'
import type { OpenedRepo, RepoSessionErrorSource } from '../../stores/repo-session'

const LOG_FLUSH_MS = 100

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
  setError: (source: RepoSessionErrorSource, error: string) => void
  clearError: (source: RepoSessionErrorSource) => void
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
  const {
    repoPath,
    tabId,
    tabActive,
    liveRepoPath,
    openGenerationRef,
    isCurrentRepo,
    setError,
    clearError
  } = deps

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
  const publishedLogBuffer = useRef<GitLogEntry[] | null>(null)
  const bufferedHashes = useRef(new Set<string>())
  const bufferRevision = useRef(0)
  const flushedRevision = useRef(-1)
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logStreamSeq = useRef(0)
  const historyErrorRef = useRef<{ message: string; streamId: number } | null>(null)

  const logQuery = useQuery({
    queryKey: repoQueryKeys(repoPath, { idle: tabId }).log,
    enabled: false,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    structuralSharing: false,
    queryFn: () => Promise.resolve<GitLog | null>(null)
  })

  const flushLogToStore = useCallback(
    (expectedGen: number, expectedPath: string | null) => {
      logFlushTimer.current = null
      if (expectedGen !== openGenerationRef.current || expectedPath !== liveRepoPath.current) {
        return
      }
      if (!expectedPath) {
        return
      }
      const logKey = repoQueryKeys(expectedPath).log
      const next = logBuffer.current
      if (flushedRevision.current === bufferRevision.current) {
        return
      }
      queryClient.setQueryData<GitLog>(logKey, { all: next, loadedCount: next.length })
      publishedLogBuffer.current = next
      flushedRevision.current = bufferRevision.current
    },
    [liveRepoPath, openGenerationRef, queryClient]
  )

  const scheduleLogFlush = useCallback(() => {
    if (logFlushTimer.current !== null) {
      return
    }
    const expectedGen = openGenerationRef.current
    const expectedPath = liveRepoPath.current
    logFlushTimer.current = setTimeout(() => {
      if (!tabActiveRef.current) {
        logFlushTimer.current = null
        return
      }
      flushLogToStore(expectedGen, expectedPath)
    }, LOG_FLUSH_MS)
  }, [flushLogToStore, liveRepoPath, openGenerationRef])

  const restart = async (repoPath: string, options?: RestartLogStreamOptions) => {
    const generation = openGenerationRef.current
    if (!isCurrentRepo(generation, repoPath)) {
      return
    }
    const skip = options?.skip ?? 0
    const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(repoPath).log)
    const maxCount = options?.maxCount ?? Math.max(LOG_PAGE_SIZE, cachedLog?.all.length ?? 0)
    const append = skip > 0
    const clearLog = options?.clearLog ?? (!append && !cachedLog)

    const streamId = ++logStreamSeq.current
    const isLatestStream = () => streamId === logStreamSeq.current

    if (!append) {
      if (logFlushTimer.current !== null) {
        clearTimeout(logFlushTimer.current)
        logFlushTimer.current = null
      }
      logBuffer.current = []
      publishedLogBuffer.current = null
      bufferedHashes.current.clear()
      bufferRevision.current += 1
      if (clearLog) {
        queryClient.setQueryData<GitLog>(repoQueryKeys(repoPath).log, {
          all: logBuffer.current,
          loadedCount: 0
        })
        publishedLogBuffer.current = logBuffer.current
        setLogUi('logHasMore', false)
      }
      setLogUi({ logLoading: true, logLoadingMore: false })
    } else {
      setLogUi({ logLoading: false, logLoadingMore: true })
    }

    try {
      const response = parseOrThrow(
        StartLogStreamResponseSchema,
        await window.electronAPI.startLogStream(repoPath, { skip, maxCount, streamId })
      )
      if (!isCurrentRepo(generation, repoPath) || !isLatestStream()) {
        return
      }
      if (response._tag === 'GitError') {
        historyErrorRef.current = { message: response.message, streamId }
        setError('history', gitFailureBannerText('Could not read history', response.message))
        setLogUi({ logLoading: false, logLoadingMore: false })
      } else {
        const previousError = historyErrorRef.current
        if (previousError && previousError.streamId !== streamId) {
          historyErrorRef.current = null
          clearError('history')
        }
      }
    } catch (error) {
      if (!isCurrentRepo(generation, repoPath) || !isLatestStream()) {
        return
      }
      const message = formatCause(error)
      historyErrorRef.current = { message, streamId }
      setError('history', gitFailureBannerText('Could not read history', message))
      setLogUi({ logLoading: false, logLoadingMore: false })
    }
  }

  const loadMoreImpl = async () => {
    const repoPath = liveRepoPath.current
    if (!repoPath || !logUi.logHasMore || logUi.logLoadingMore || logUi.logLoading) {
      return
    }
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
      setError('history', gitFailureBannerText('Could not read history', formatCause(error)))
    })
  }

  const onRepoOpened = (opened: OpenedRepo, generation: number) => {
    const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(opened.path).log)
    setLogUi({ logLoading: false, logLoadingMore: false, logHasMore: false })
    logBuffer.current = cachedLog?.all ? [...cachedLog.all] : []
    publishedLogBuffer.current = null
    bufferedHashes.current = new Set(logBuffer.current.map((commit) => commit.hash))
    bufferRevision.current += 1
    flushedRevision.current = cachedLog ? bufferRevision.current : -1
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
    publishedLogBuffer.current = null
    bufferedHashes.current.clear()
    historyErrorRef.current = null
    bufferRevision.current += 1
    flushedRevision.current = -1
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
  }, [tabActive, scheduleLogFlush])

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
        let appended = false
        for (const commit of chunk.commits) {
          if (bufferedHashes.current.has(commit.hash)) {
            continue
          }
          if (!appended && publishedLogBuffer.current === logBuffer.current) {
            logBuffer.current = [...logBuffer.current]
            publishedLogBuffer.current = null
          }
          bufferedHashes.current.add(commit.hash)
          logBuffer.current.push(commit)
          appended = true
        }
        if (appended) {
          bufferRevision.current += 1
          scheduleLogFlush()
        }
      }
      if (chunk.error) {
        historyErrorRef.current = {
          message: chunk.error,
          streamId: chunk.streamId ?? logStreamSeq.current
        }
        setError('history', gitFailureBannerText('Could not read history', chunk.error))
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
