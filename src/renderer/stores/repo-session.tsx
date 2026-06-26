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
import { rpcCloseRepo, rpcOpenRepo } from '@/lib/rpc-client'

export interface OpenedRepo {
  path: string
  remotes: Record<string, string>
  defaultBranch?: string
}

interface RepoSessionState {
  repoPath: string | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  opening: boolean
  error: string | null
  openGeneration: number
}

export interface RepoSession {
  repoPath: string | null
  opening: boolean
  openGeneration: number
  error: string | null
  openRepo: (requestedPath: string) => Promise<string | null>
  closeRepo: () => Promise<void>
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
  setError: (error: string | null) => void
  publicValue: RepoSession
}

export interface RepoSessionLifecycleRef {
  current: RepoSessionLifecycle
}

const initialSessionState: RepoSessionState = {
  repoPath: null,
  remotes: {},
  defaultBranch: undefined,
  opening: false,
  error: null,
  openGeneration: 0
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
  const openGenerationRef = useRef(sessionState.openGeneration)
  const unmountCleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  liveRepoPath.current = sessionState.repoPath

  const setError = useCallback((error: string | null) => {
    setSessionState((previous) => {
      if (Object.is(previous.error, error)) {
        return previous
      }
      return { ...previous, error }
    })
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
      setSessionState({ ...initialSessionState, openGeneration })
      lifecycle.current.onSessionReset()
    },
    [lifecycle]
  )

  const openRepo = useCallback(
    async (requestedPath: string): Promise<string | null> => {
      const generation = bumpOpenGeneration()
      setSessionState((previous) => ({
        ...previous,
        opening: true,
        error: null,
        openGeneration: generation
      }))

      try {
        const openResponse = await rpcOpenRepo(requestedPath)
        if (generation !== openGenerationRef.current) {
          if (openResponse._tag === 'Ok' && openResponse.result.path !== liveRepoPath.current) {
            void rpcCloseRepo(openResponse.result.path).catch(() => {})
          }
          return null
        }

        if (openResponse._tag !== 'Ok') {
          const errorMessage =
            openResponse._tag === 'NotARepo' ? 'Not a git repository' : openResponse.message
          setSessionState((previous) => ({ ...previous, opening: false, error: errorMessage }))
          return null
        }

        const previousPath = liveRepoPath.current
        const opened = openResponse.result
        if (previousPath && previousPath !== opened.path) {
          try {
            await lifecycle.current.onBeforeRepoClosed(previousPath)
            await rpcCloseRepo(previousPath)
          } catch {}
          if (generation !== openGenerationRef.current) {
            if (opened.path !== liveRepoPath.current) {
              void rpcCloseRepo(opened.path).catch(() => {})
            }
            return null
          }
        }
        liveRepoPath.current = opened.path
        setSessionState({
          repoPath: opened.path,
          remotes: opened.remotes,
          defaultBranch: opened.defaultBranch,
          opening: false,
          error: null,
          openGeneration: generation
        })
        lifecycle.current.onRepoOpened(opened, generation)
        return opened.path
      } catch (error) {
        if (generation !== openGenerationRef.current) {
          return null
        }
        setSessionState((previous) => ({
          ...previous,
          opening: false,
          error: formatCause(error)
        }))
        return null
      }
    },
    [bumpOpenGeneration, lifecycle]
  )

  const closeRepo = useCallback(async () => {
    const generation = bumpOpenGeneration()
    const repoPath = liveRepoPath.current
    if (repoPath) {
      try {
        await lifecycle.current.onBeforeRepoClosed(repoPath)
        await rpcCloseRepo(repoPath)
      } catch {}
    }
    reset(generation)
  }, [bumpOpenGeneration, lifecycle, reset])

  useEffect(() => {
    if (unmountCleanupTimer.current !== null) {
      clearTimeout(unmountCleanupTimer.current)
      unmountCleanupTimer.current = null
    }

    return () => {
      unmountCleanupTimer.current = setTimeout(() => {
        unmountCleanupTimer.current = null
        const openGeneration = openGenerationRef.current + 1
        openGenerationRef.current = openGeneration
        lifecycle.current.onSessionReset()

        const repoPath = liveRepoPath.current
        liveRepoPath.current = null
        if (!repoPath) {
          return
        }
        Promise.resolve(lifecycle.current.onBeforeRepoClosed(repoPath)).catch(() => {})
        Promise.resolve(rpcCloseRepo(repoPath)).catch(() => {})
      }, 0)
    }
  }, [lifecycle])

  const publicValue = useMemo<RepoSession>(
    () => ({
      repoPath: sessionState.repoPath,
      opening: sessionState.opening,
      openGeneration: sessionState.openGeneration,
      error: sessionState.error,
      openRepo,
      closeRepo
    }),
    [
      sessionState.repoPath,
      sessionState.opening,
      sessionState.openGeneration,
      sessionState.error,
      openRepo,
      closeRepo
    ]
  )

  return {
    ...publicValue,
    remotes: sessionState.remotes,
    defaultBranch: sessionState.defaultBranch,
    liveRepoPath,
    openGenerationRef,
    setError,
    publicValue
  }
}
