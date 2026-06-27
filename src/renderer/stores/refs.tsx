import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
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
import { repoQueryKeys } from '@/lib/query-keys'
import { rpcFetch, rpcGetLocalBranches, rpcGetRemoteRefs } from '@/lib/rpc-client'
import type { GitBranches } from '@/types'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000
// Closed repos keep their branches cached this long so reopening repaints instantly — scoped to
// these queries (not the global default) so transient diff/hunk-highlight queries still expire on
// the normal schedule.
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

export interface RefsDeps {
  repoPath: string | null
  tabId: string
  tabActive: boolean
  remotes: Record<string, string>
  defaultBranch: string | undefined
  statusCurrent: string | undefined
  liveRepoPath: RefObject<string | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repoPath: string) => boolean
  setError: (error: string | null) => void
}

export interface Refs {
  branches: GitBranches | null
  currentBranch: string
  branchesLoading: boolean
  lastFetchedAt: number | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  fetchNow: () => Promise<void>
}

export interface RefsController {
  branches: GitBranches | null
  currentBranch: string
  branchesLoading: boolean
  lastFetchedAt: number | null
  fetchNow: () => Promise<void>
  localBranchesError: unknown
  remoteRefsError: unknown
  value: Refs
}

export function useRefsController(deps: RefsDeps): RefsController {
  const queryClient = useQueryClient()
  const {
    repoPath,
    tabId,
    tabActive,
    remotes,
    defaultBranch,
    statusCurrent,
    liveRepoPath,
    openGenerationRef,
    isCurrentRepo,
    setError
  } = deps

  const repoKeys = repoQueryKeys(repoPath, { idle: tabId })

  const tabActiveRef = useRef(tabActive)
  tabActiveRef.current = tabActive

  const [fetchTick, setFetchTick] = useState(0)
  // Scope the fetched timestamp to the repo it was fetched for so a tab that switches repos does not
  // surface the previous repo's "Fetched …" status until the new repo is fetched.
  const [lastFetch, setLastFetch] = useState<{ repoPath: string; fetchedAt: number } | null>(null)
  const lastFetchedAt = lastFetch?.repoPath === repoPath ? lastFetch.fetchedAt : null

  const localBranchesQuery = useQuery({
    queryKey: repoKeys.localBranches,
    enabled: Boolean(repoPath),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchLocalBranches(queryKey[1] as string)
  })

  const remoteRefsQuery = useQuery({
    queryKey: repoKeys.remoteRefs,
    enabled: Boolean(repoPath) && Boolean(localBranchesQuery.data),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: ({ queryKey }) => fetchRemoteRefs(queryKey[1] as string)
  })

  const branches = useMemo(
    () => combineBranches(localBranchesQuery.data, remoteRefsQuery.data),
    [localBranchesQuery.data, remoteRefsQuery.data]
  )

  // Prefer the dedicated branch source over status.current: a branch-only refresh (e.g. renaming
  // the checked-out branch) updates localBranches but not status, and status.current would
  // otherwise keep showing the old name until an unrelated status refetch. Falls back to
  // status.current when there is no named branch (detached HEAD reports an empty current).
  const currentBranch = localBranchesQuery.data?.current || statusCurrent || ''
  const branchesLoading = localBranchesQuery.isFetching && !localBranchesQuery.data

  const refreshRefsCaches = (path: string): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(path).localBranches }),
      queryClient.invalidateQueries({ queryKey: repoQueryKeys(path).remoteRefs })
    ])

  // Owns its own error handling so both callers — the manual fetch and the fire-and-forget auto-fetch
  // interval — surface a rejected rpcFetch/refresh instead of leaking an unhandled rejection.
  const runFetchAndRefresh = async (path: string) => {
    const generation = openGenerationRef.current
    if (!isCurrentRepo(generation, path)) {
      return
    }
    try {
      const response = await rpcFetch(path)
      if (!isCurrentRepo(generation, path)) {
        return
      }
      if (response._tag === 'Ok') {
        setLastFetch({ repoPath: path, fetchedAt: Date.now() })
        if (tabActiveRef.current) {
          await refreshRefsCaches(path)
        }
      } else if (response._tag === 'GitError') {
        setError(response.message)
      }
    } catch (error) {
      if (isCurrentRepo(generation, path)) {
        setError(formatCause(error))
      }
    }
  }

  const fetchNowImpl = async () => {
    const path = liveRepoPath.current
    if (!path) {
      return
    }
    setFetchTick((tick) => tick + 1)
    await runFetchAndRefresh(path)
  }

  const latest = useRef({
    isTabActive: () => tabActiveRef.current,
    runFetchAndRefresh,
    fetchNow: fetchNowImpl
  })
  latest.current = {
    isTabActive: () => tabActiveRef.current,
    runFetchAndRefresh,
    fetchNow: fetchNowImpl
  }

  const fetchNow = useCallback(() => latest.current.fetchNow(), [])

  useEffect(() => {
    // fetchTick is a dependency on purpose: a manual fetch bumps it, re-running this effect and
    // restarting the interval, so the 5-minute cadence resets and we never auto-fetch right after a
    // manual one. Trade-off: fetching manually more often than every 5 minutes postpones the
    // independent auto-fetch indefinitely — acceptable, since the user is already fetching.
    void fetchTick
    if (!repoPath) {
      return
    }
    const handle = window.setInterval(() => {
      const { isTabActive, runFetchAndRefresh } = latest.current
      if (isTabActive()) {
        void runFetchAndRefresh(repoPath)
      }
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [repoPath, fetchTick])

  const value = useMemo<Refs>(
    () => ({
      branches,
      currentBranch,
      branchesLoading,
      lastFetchedAt,
      remotes,
      defaultBranch,
      fetchNow
    }),
    [branches, currentBranch, branchesLoading, lastFetchedAt, remotes, defaultBranch, fetchNow]
  )

  return {
    branches,
    currentBranch,
    branchesLoading,
    lastFetchedAt,
    fetchNow,
    localBranchesError: localBranchesQuery.error,
    remoteRefsError: remoteRefsQuery.error,
    value
  }
}

const RefsContext = createContext<Refs | null>(null)

export const RefsProvider = RefsContext.Provider

export function useRefs(): Refs {
  const value = useContext(RefsContext)
  if (!value) {
    throw new Error('useRefs must be used within a GitStoreProvider')
  }
  return value
}
