import type { RepoRef } from '@common/features/repository-identity'
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
import {
  type RepositoryIdentity,
  repoQueryKeys,
  repositoryIdentityKey
} from '@/features/repository-identity'
import { useLatestRef } from '@/hooks/useLatestRef'
import { formatCause } from '@/lib/format-cause'
import { engineFailureBannerText, gitFailureBannerText } from '@/lib/git-report'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import type { GitLog } from '@/types'
import type { OpenedRepo, RepoSessionErrorSource } from '../../stores/repo-session'
import { createCommitLogBuffer } from './log-buffer'

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
  repository: RepoRef | null
  tabId: string
  tabActive: boolean
  liveRepoRef: RefObject<RepoRef | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repository: RepositoryIdentity) => boolean
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
  restart: (repository: RepositoryIdentity, options?: RestartLogStreamOptions) => Promise<void>
  onRepoOpened: (opened: OpenedRepo, generation: number) => void
  cancelStream: (repoPath: string) => Promise<void>
  reset: () => void
}

export function useCommitHistoryController(deps: CommitHistoryDeps): CommitHistoryController {
  const queryClient = useQueryClient()
  const {
    repository,
    tabId,
    tabActive,
    liveRepoRef,
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

  const logBuffer = useRef(createCommitLogBuffer())
  const logFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logStreamSeq = useRef(0)
  const historyErrorRef = useRef<{ message: string; streamId: number } | null>(null)

  const logQuery = useQuery({
    queryKey: repoQueryKeys(repository, { idle: tabId }).log,
    enabled: false,
    gcTime: WARM_REOPEN_GC_TIME_MS,
    structuralSharing: false,
    queryFn: () => Promise.resolve<GitLog | null>(null)
  })

  const flushLogToStore = useCallback(
    (expectedGen: number, expectedRepository: RepoRef | null) => {
      logFlushTimer.current = null
      const currentRepository = liveRepoRef.current
      if (
        expectedGen !== openGenerationRef.current ||
        expectedRepository === null ||
        currentRepository === null ||
        repositoryIdentityKey(expectedRepository) !== repositoryIdentityKey(currentRepository)
      ) {
        return
      }
      const logKey = repoQueryKeys(expectedRepository).log
      const next = logBuffer.current.getPublishableSnapshot()
      if (next === null) {
        return
      }
      queryClient.setQueryData<GitLog>(logKey, { all: next, loadedCount: next.length })
      logBuffer.current.markCurrentAsFlushed()
    },
    [liveRepoRef, openGenerationRef, queryClient]
  )

  const scheduleLogFlush = useCallback(() => {
    if (logFlushTimer.current !== null) {
      return
    }
    const expectedGen = openGenerationRef.current
    const expectedRepository = liveRepoRef.current
    logFlushTimer.current = setTimeout(() => {
      if (!tabActiveRef.current) {
        logFlushTimer.current = null
        return
      }
      flushLogToStore(expectedGen, expectedRepository)
    }, LOG_FLUSH_MS)
  }, [flushLogToStore, liveRepoRef, openGenerationRef])

  const restart = async (candidate: RepositoryIdentity, options?: RestartLogStreamOptions) => {
    const repoPath = typeof candidate === 'string' ? candidate : candidate.path
    const generation = openGenerationRef.current
    if (!isCurrentRepo(generation, candidate)) {
      return
    }
    const skip = options?.skip ?? 0
    const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(candidate).log)
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
      logBuffer.current.beginStream()
      if (clearLog) {
        const entries = logBuffer.current.markCurrentAsPublished()
        queryClient.setQueryData<GitLog>(repoQueryKeys(candidate).log, {
          all: entries,
          loadedCount: 0
        })
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
      if (!isCurrentRepo(generation, candidate) || !isLatestStream()) {
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
      if (!isCurrentRepo(generation, candidate) || !isLatestStream()) {
        return
      }
      const message = formatCause(error)
      historyErrorRef.current = { message, streamId }
      setError('history', engineFailureBannerText('Could not read history', message))
      setLogUi({ logLoading: false, logLoadingMore: false })
    }
  }

  const loadMoreImpl = async () => {
    const currentRepository = liveRepoRef.current
    if (!currentRepository || !logUi.logHasMore || logUi.logLoadingMore || logUi.logLoading) {
      return
    }
    const cached = queryClient.getQueryData<GitLog>(repoQueryKeys(currentRepository).log)
    const skip = Math.max(logBuffer.current.length, cached?.all.length ?? 0)
    await restart(currentRepository, { skip, maxCount: LOG_PAGE_SIZE, clearLog: false })
  }

  const loadMoreRef = useRef(loadMoreImpl)
  loadMoreRef.current = loadMoreImpl
  const loadMoreHistory = useCallback(() => loadMoreRef.current(), [])

  const runIfCurrent = (
    generation: number,
    candidate: RepositoryIdentity,
    label: string,
    task: () => Promise<void>
  ) => {
    void task().catch((error: unknown) => {
      if (!isCurrentRepo(generation, candidate)) {
        return
      }
      console.error(`[git] ${label} failed for repository:`, formatCause(error))
      setError('history', engineFailureBannerText('Could not read history', formatCause(error)))
    })
  }

  const onRepoOpened = (_opened: OpenedRepo, generation: number) => {
    const openedRepository = liveRepoRef.current
    if (!openedRepository) {
      return
    }
    const cachedLog = queryClient.getQueryData<GitLog>(repoQueryKeys(openedRepository).log)
    setLogUi({ logLoading: false, logLoadingMore: false, logHasMore: false })
    logBuffer.current.restore(cachedLog?.all ?? [], cachedLog !== undefined)
    runIfCurrent(generation, openedRepository, 'restartLogStream', async () => {
      await restart(openedRepository, { clearLog: !cachedLog })
    })
  }

  const cancelStream = (repoPath: string) =>
    Promise.resolve(window.electronAPI.cancelLogStream(repoPath))
      .then(() => undefined)
      .catch(() => {})

  const reset = () => {
    logBuffer.current.clear()
    historyErrorRef.current = null
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
    getRepository: () => liveRepoRef.current,
    setError,
    scheduleLogFlush,
    flushLogToStore
  })

  useEffect(() => {
    const unsubLog = window.electronAPI.onLogChunk((chunk) => {
      const { getOpenGeneration, getRepository, scheduleLogFlush, flushLogToStore, setError } =
        latest.current
      const currentRepository = getRepository()
      if (chunk.repoPath !== currentRepository?.path) {
        return
      }
      if (chunk.streamId !== undefined && chunk.streamId !== logStreamSeq.current) {
        return
      }
      if (chunk.commits.length > 0) {
        if (logBuffer.current.append(chunk.commits)) {
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
        flushLogToStore(getOpenGeneration(), currentRepository)
        setLogUi('logLoading', false)
        setLogUi('logLoadingMore', false)
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
