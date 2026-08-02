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
import { formatCause } from '@/lib/format-cause'
import { gitFailureBannerText } from '@/lib/git-report'
import { rpcCloseRepo, rpcDisownRepo, rpcOpenRepo } from '@/lib/rpc-client'
import {
  clearRepoSessionError,
  completeRepoOpening,
  displayedRepoSessionError,
  failRepoOpening,
  initialRepoSessionState,
  type OpenedRepo,
  type RepoSessionErrorSource,
  type RepoSessionState,
  resetRepoSession,
  setRepoSessionError,
  startRepoOpening
} from './repo-session-state'

export type { OpenedRepo, RepoSessionErrorSource } from './repo-session-state'

export interface RepoSession {
  repoPath: string | null
  opening: boolean
  openGeneration: number
  resetEpoch: number
  error: string | null
  openRepo: (requestedPath: string) => Promise<string | null>
  closeRepo: () => Promise<void>
  disownRepo: () => void
}

export interface RepoSessionLifecycle {
  onRepoOpened: (opened: OpenedRepo, generation: number) => void
  onBeforeRepoClosed: (repoPath: string) => Promise<void> | void
  onSessionReset: () => void
}

export interface RepoSessionController extends RepoSession {
  remotes: Record<string, string>
  defaultBranch: string | undefined
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  setError: (source: RepoSessionErrorSource, error: string) => void
  clearError: (source: RepoSessionErrorSource) => void
  publicValue: RepoSession
}

export interface RepoSessionLifecycleRef {
  current: RepoSessionLifecycle
}

const initialSessionState = initialRepoSessionState()

const pendingUnmountCloses = new Map<string, ReturnType<typeof setTimeout>>()
const canonicalPathByRequestedPath = new Map<string, string>()
const activeRepoOpenRequests = new Map<string, number>()
let nextRepoOwner = 0

const beginRepoOpenRequest = (requestedPath: string): string => {
  const identity = canonicalPathByRequestedPath.get(requestedPath) ?? requestedPath
  activeRepoOpenRequests.set(identity, (activeRepoOpenRequests.get(identity) ?? 0) + 1)
  return identity
}

const endRepoOpenRequest = (identity: string) => {
  const remaining = (activeRepoOpenRequests.get(identity) ?? 0) - 1
  if (remaining > 0) {
    activeRepoOpenRequests.set(identity, remaining)
  } else {
    activeRepoOpenRequests.delete(identity)
  }
}

const cancelPendingUnmountClose = (repoPath: string) => {
  const timer = pendingUnmountCloses.get(repoPath)
  if (timer !== undefined) {
    clearTimeout(timer)
    pendingUnmountCloses.delete(repoPath)
  }
}

export const emptyRepoSessionLifecycle: RepoSessionLifecycle = {
  onRepoOpened: () => {},
  onBeforeRepoClosed: () => {},
  onSessionReset: () => {}
}

export const RepoSessionContext = createContext<RepoSession | null>(null)
export const RepoSessionProvider = RepoSessionContext.Provider

export function useRepoSession(): RepoSession {
  const value = useContext(RepoSessionContext)
  if (!value) {
    throw new Error('useRepoSession must be used within a GitStoreProvider')
  }
  return value
}

export function useRepoSessionController(
  lifecycle: RepoSessionLifecycleRef
): RepoSessionController {
  const [sessionState, setSessionState] = useState<RepoSessionState>(initialSessionState)
  const liveRepoPath = useRef<string | null>(sessionState.repoPath)
  const liveRepoOwner = useRef<number | null>(null)
  const openGenerationRef = useRef(sessionState.openGeneration)
  const errorSequenceRef = useRef(0)

  liveRepoPath.current = sessionState.repoPath

  const setError = useCallback((source: RepoSessionErrorSource, error: string) => {
    const sequence = ++errorSequenceRef.current
    setSessionState((previous) => setRepoSessionError(previous, source, error, sequence))
  }, [])

  const clearError = useCallback((source: RepoSessionErrorSource) => {
    setSessionState((previous) => clearRepoSessionError(previous, source))
  }, [])

  const bumpOpenGeneration = useCallback(() => {
    const openGeneration = openGenerationRef.current + 1
    openGenerationRef.current = openGeneration
    setSessionState((previous) => ({ ...previous, openGeneration }))
    return openGeneration
  }, [])

  const reset = useCallback(
    (openGeneration: number) => {
      liveRepoPath.current = null
      liveRepoOwner.current = null
      setSessionState((previous) => resetRepoSession(previous, openGeneration))
      lifecycle.current.onSessionReset()
    },
    [lifecycle]
  )

  const openRepo = useCallback(
    async (requestedPath: string): Promise<string | null> => {
      cancelPendingUnmountClose(canonicalPathByRequestedPath.get(requestedPath) ?? requestedPath)
      const owner = ++nextRepoOwner
      const previousOwner = liveRepoOwner.current
      const generation = bumpOpenGeneration()
      setSessionState((previous) => startRepoOpening(previous, generation))
      const openRequestIdentity = beginRepoOpenRequest(requestedPath)

      try {
        const openResponse = await rpcOpenRepo(requestedPath, owner)
        if (generation !== openGenerationRef.current) {
          if (openResponse._tag === 'Ok' && openResponse.result.path !== liveRepoPath.current) {
            void rpcCloseRepo(openResponse.result.path, owner).catch(() => {})
          }
          return null
        }

        if (openResponse._tag !== 'Ok') {
          const errorMessage =
            openResponse._tag === 'NotARepo'
              ? 'Not a git repository'
              : gitFailureBannerText('Could not open this repository', openResponse.message)
          const sequence = ++errorSequenceRef.current
          setSessionState((previous) => failRepoOpening(previous, errorMessage, sequence))
          return null
        }

        const previousPath = liveRepoPath.current
        const opened = openResponse.result
        canonicalPathByRequestedPath.set(requestedPath, opened.path)
        canonicalPathByRequestedPath.set(opened.path, opened.path)
        cancelPendingUnmountClose(opened.path)
        if (previousPath && previousPath !== opened.path) {
          try {
            await lifecycle.current.onBeforeRepoClosed(previousPath)
            if (previousOwner !== null) {
              await rpcCloseRepo(previousPath, previousOwner)
            }
          } catch {}
          if (generation !== openGenerationRef.current) {
            if (opened.path !== liveRepoPath.current) {
              void rpcCloseRepo(opened.path, owner).catch(() => {})
            }
            return null
          }
        }
        liveRepoPath.current = opened.path
        liveRepoOwner.current = owner
        setSessionState((previous) => completeRepoOpening(previous, opened, generation))
        lifecycle.current.onRepoOpened(opened, generation)
        return opened.path
      } catch (error) {
        if (generation !== openGenerationRef.current) {
          return null
        }
        const sequence = ++errorSequenceRef.current
        setSessionState((previous) => failRepoOpening(previous, formatCause(error), sequence))
        return null
      } finally {
        endRepoOpenRequest(openRequestIdentity)
      }
    },
    [bumpOpenGeneration, lifecycle]
  )

  const closeRepo = useCallback(async () => {
    const generation = bumpOpenGeneration()
    const repoPath = liveRepoPath.current
    const owner = liveRepoOwner.current
    if (repoPath && owner !== null) {
      try {
        await lifecycle.current.onBeforeRepoClosed(repoPath)
        await rpcCloseRepo(repoPath, owner)
      } catch {}
    }
    reset(generation)
  }, [bumpOpenGeneration, lifecycle, reset])

  const disownRepo = useCallback(() => {
    const generation = bumpOpenGeneration()
    const repoPath = liveRepoPath.current
    const owner = liveRepoOwner.current
    liveRepoPath.current = null
    liveRepoOwner.current = null
    setSessionState((previous) => resetRepoSession(previous, generation))
    if (repoPath) {
      Promise.resolve(lifecycle.current.onBeforeRepoClosed(repoPath)).catch(() => {})
      if (owner !== null) {
        void rpcDisownRepo(repoPath, owner).catch(() => {})
      }
    }
    lifecycle.current.onSessionReset()
  }, [bumpOpenGeneration, lifecycle])

  useEffect(() => {
    const repoPath = liveRepoPath.current
    if (repoPath) {
      cancelPendingUnmountClose(repoPath)
    }

    return () => {
      const closingRepoPath = liveRepoPath.current
      const closingRepoOwner = liveRepoOwner.current
      const openGeneration = openGenerationRef.current + 1
      openGenerationRef.current = openGeneration
      lifecycle.current.onSessionReset()
      liveRepoPath.current = null
      liveRepoOwner.current = null
      setSessionState((previous) => resetRepoSession(previous, openGeneration, true))
      if (!closingRepoPath || closingRepoOwner === null) {
        return
      }
      let timer: ReturnType<typeof setTimeout>
      const closeWhenReconciled = () => {
        if (pendingUnmountCloses.get(closingRepoPath) !== timer) {
          return
        }
        if ((activeRepoOpenRequests.get(closingRepoPath) ?? 0) > 0) {
          timer = setTimeout(closeWhenReconciled, 10)
          pendingUnmountCloses.set(closingRepoPath, timer)
          return
        }
        pendingUnmountCloses.delete(closingRepoPath)
        Promise.resolve(lifecycle.current.onBeforeRepoClosed(closingRepoPath)).catch(() => {})
        Promise.resolve(rpcCloseRepo(closingRepoPath, closingRepoOwner)).catch(() => {})
      }
      timer = setTimeout(closeWhenReconciled, 0)
      pendingUnmountCloses.set(closingRepoPath, timer)
    }
  }, [lifecycle])

  const publicValue = useMemo<RepoSession>(() => {
    const error = displayedRepoSessionError(sessionState.errors)
    return {
      repoPath: sessionState.repoPath,
      opening: sessionState.opening,
      openGeneration: sessionState.openGeneration,
      resetEpoch: sessionState.resetEpoch,
      error: error?.message ?? null,
      openRepo,
      closeRepo,
      disownRepo
    }
  }, [
    sessionState.repoPath,
    sessionState.opening,
    sessionState.openGeneration,
    sessionState.resetEpoch,
    sessionState.errors,
    openRepo,
    closeRepo,
    disownRepo
  ])

  return {
    ...publicValue,
    remotes: sessionState.remotes,
    defaultBranch: sessionState.defaultBranch,
    liveRepoPath,
    openGenerationRef,
    setError,
    clearError,
    publicValue
  }
}
