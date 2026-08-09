import type { RepoRef } from '@common/features/repository-identity'
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
  repositoryIdentityKey,
  toRepoRef
} from '@/features/repository-identity'
import { formatCause } from '@/lib/format-cause'
import { gitFailureBannerText } from '@/lib/git-report'
import { rpcCloseRepo, rpcDisownRepo, rpcOpenRepo } from '@/lib/rpc-client'
import { createRepoSessionOwnership } from './repo-session-ownership'
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
  repoRef: RepoRef | null
  repoPath: string | null
  opening: boolean
  openGeneration: number
  resetEpoch: number
  error: string | null
  openRepo: (requestedRepository: RepositoryIdentity) => Promise<string | null>
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
  liveRepoRef: RefObject<RepoRef | null>
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

const repoSessionOwnership = createRepoSessionOwnership()

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
  const liveRepoRef = useRef<RepoRef | null>(sessionState.repoRef)
  const liveRepoPath = useRef<string | null>(sessionState.repoPath)
  const liveRepoOwner = useRef<number | null>(null)
  const openGenerationRef = useRef(sessionState.openGeneration)
  const errorSequenceRef = useRef(0)

  liveRepoRef.current = sessionState.repoRef
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
      liveRepoRef.current = null
      liveRepoOwner.current = null
      setSessionState((previous) => resetRepoSession(previous, openGeneration))
      lifecycle.current.onSessionReset()
    },
    [lifecycle]
  )

  const openRepo = useCallback(
    async (requestedRepository: RepositoryIdentity): Promise<string | null> => {
      const requestedRepoRef = toRepoRef(requestedRepository)
      const requestedPath = repoSessionOwnership.resolvePath(requestedRepoRef)
      repoSessionOwnership.cancelPendingClose(requestedRepoRef)
      const owner = repoSessionOwnership.nextOwner()
      const previousOwner = liveRepoOwner.current
      const generation = bumpOpenGeneration()
      setSessionState((previous) => startRepoOpening(previous, generation))
      const openRequestIdentity = repoSessionOwnership.beginOpen(requestedRepoRef)

      try {
        const openResponse = await rpcOpenRepo(requestedPath, owner)
        if (generation !== openGenerationRef.current) {
          if (openResponse._tag === 'Ok') {
            const staleOpenedRepoRef = { ...requestedRepoRef, path: openResponse.result.path }
            const currentRepoRef = liveRepoRef.current
            if (
              !currentRepoRef ||
              repositoryIdentityKey(staleOpenedRepoRef) !== repositoryIdentityKey(currentRepoRef)
            ) {
              void rpcCloseRepo(openResponse.result.path, owner).catch(() => {})
            }
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

        const previousRepoRef = liveRepoRef.current
        const opened = openResponse.result
        const openedRepoRef = { ...requestedRepoRef, path: opened.path }
        repoSessionOwnership.rememberCanonicalPath(requestedRepoRef, openedRepoRef)
        repoSessionOwnership.cancelPendingClose(openedRepoRef)
        if (
          previousRepoRef &&
          repositoryIdentityKey(previousRepoRef) !== repositoryIdentityKey(openedRepoRef)
        ) {
          try {
            await lifecycle.current.onBeforeRepoClosed(previousRepoRef.path)
            if (previousOwner !== null) {
              await rpcCloseRepo(previousRepoRef.path, previousOwner)
            }
          } catch {}
          if (generation !== openGenerationRef.current) {
            const currentRepoRef = liveRepoRef.current
            if (
              !currentRepoRef ||
              repositoryIdentityKey(openedRepoRef) !== repositoryIdentityKey(currentRepoRef)
            ) {
              void rpcCloseRepo(opened.path, owner).catch(() => {})
            }
            return null
          }
        }
        liveRepoRef.current = openedRepoRef
        liveRepoPath.current = opened.path
        liveRepoOwner.current = owner
        setSessionState((previous) =>
          completeRepoOpening(previous, opened, openedRepoRef, generation)
        )
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
        repoSessionOwnership.endOpen(openRequestIdentity)
      }
    },
    [bumpOpenGeneration, lifecycle]
  )

  const closeRepo = useCallback(async () => {
    const generation = bumpOpenGeneration()
    const repoRef = liveRepoRef.current
    const repoPath = liveRepoPath.current
    const owner = liveRepoOwner.current
    if (repoPath && owner !== null) {
      try {
        await lifecycle.current.onBeforeRepoClosed(repoPath)
        await rpcCloseRepo(repoPath, owner)
      } catch {}
    }
    if (repoRef) {
      repoSessionOwnership.releasePendingClose(repoRef)
    }
    reset(generation)
  }, [bumpOpenGeneration, lifecycle, reset])

  const disownRepo = useCallback(() => {
    const generation = bumpOpenGeneration()
    const repoRef = liveRepoRef.current
    const repoPath = liveRepoPath.current
    const owner = liveRepoOwner.current
    liveRepoRef.current = null
    liveRepoPath.current = null
    liveRepoOwner.current = null
    setSessionState((previous) => resetRepoSession(previous, generation))
    if (repoPath && repoRef) {
      repoSessionOwnership.releasePendingClose(repoRef)
      Promise.resolve(lifecycle.current.onBeforeRepoClosed(repoPath)).catch(() => {})
      if (owner !== null) {
        void rpcDisownRepo(repoPath, owner).catch(() => {})
      }
    }
    lifecycle.current.onSessionReset()
  }, [bumpOpenGeneration, lifecycle])

  useEffect(() => {
    const repoRef = liveRepoRef.current
    if (repoRef) {
      repoSessionOwnership.cancelPendingClose(repoRef)
    }

    return () => {
      const closingRepoRef = liveRepoRef.current
      const closingRepoPath = liveRepoPath.current
      const closingRepoOwner = liveRepoOwner.current
      const openGeneration = openGenerationRef.current + 1
      openGenerationRef.current = openGeneration
      lifecycle.current.onSessionReset()
      liveRepoRef.current = null
      liveRepoPath.current = null
      liveRepoOwner.current = null
      setSessionState((previous) => resetRepoSession(previous, openGeneration, true))
      if (!closingRepoRef || !closingRepoPath || closingRepoOwner === null) {
        return
      }
      let timer: ReturnType<typeof setTimeout>
      const closeWhenReconciled = () => {
        if (!repoSessionOwnership.matchesPendingClose(closingRepoRef, timer)) {
          return
        }
        if (repoSessionOwnership.hasActiveOpen(closingRepoRef)) {
          timer = setTimeout(closeWhenReconciled, 10)
          repoSessionOwnership.trackPendingClose(closingRepoRef, timer)
          return
        }
        repoSessionOwnership.releasePendingClose(closingRepoRef)
        Promise.resolve(lifecycle.current.onBeforeRepoClosed(closingRepoPath)).catch(() => {})
        Promise.resolve(rpcCloseRepo(closingRepoPath, closingRepoOwner)).catch(() => {})
      }
      timer = setTimeout(closeWhenReconciled, 0)
      repoSessionOwnership.trackPendingClose(closingRepoRef, timer)
    }
  }, [lifecycle])

  const publicValue = useMemo<RepoSession>(() => {
    const error = displayedRepoSessionError(sessionState.errors)
    return {
      repoRef: sessionState.repoRef,
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
    sessionState.repoRef,
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
    liveRepoRef,
    liveRepoPath,
    openGenerationRef,
    setError,
    clearError,
    publicValue
  }
}
