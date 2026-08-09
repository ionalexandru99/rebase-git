import type { RepoRef } from '@common/features/repository-identity'
import type { LocalBranches, RemoteRefs } from '@shared/schemas/git'
import { useQuery } from '@tanstack/react-query'
import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import {
  type RepositoryIdentity,
  repoQueryKeys,
  repositoryIdentityKey
} from '@/features/repository-identity'
import { useLatestRef } from '@/hooks/useLatestRef'
import { formatCause } from '@/lib/format-cause'
import { toastEngineFailure, toastGitFailure } from '@/lib/git-report'
import { WARM_REOPEN_GC_TIME_MS } from '@/lib/query-config'
import { rpcFetch, rpcGetLocalBranches, rpcGetRemoteRefs } from '@/lib/rpc-client'
import { unwrapOk } from '@/lib/unwrap-rpc-result'
import type { GitBranches } from '@/types'
import type { RepoMutationCoordinator } from '../../stores/action-runner'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000
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
    tracking: local?.tracking,
    lastCommitAt: local?.lastCommitAt,
    remoteLastCommitAt: remote?.remoteLastCommitAt,
    tagLastCommitAt: remote?.tagLastCommitAt
  }
}

const fetchLocalBranches = async (path: string): Promise<LocalBranches> => {
  return unwrapOk(await rpcGetLocalBranches(path)).branches
}

const fetchRemoteRefs = async (path: string): Promise<RemoteRefs> => {
  return unwrapOk(await rpcGetRemoteRefs(path)).refs
}

export interface RefsDeps {
  repoPath: string | null
  repository: RepoRef | null
  tabId: string
  tabActive: boolean
  remotes: Record<string, string>
  defaultBranch: string | undefined
  statusCurrent: string | undefined
  liveRepoRef: RefObject<RepoRef | null>
  openGenerationRef: RefObject<number>
  isCurrentRepo: (generation: number, repository: RepositoryIdentity) => boolean
  mutationCoordinator: RepoMutationCoordinator
  refreshAfterFetch: (repository: RepositoryIdentity) => Promise<unknown>
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
  const {
    repoPath,
    repository,
    tabId,
    tabActive,
    remotes,
    defaultBranch,
    statusCurrent,
    liveRepoRef,
    openGenerationRef,
    isCurrentRepo,
    mutationCoordinator,
    refreshAfterFetch
  } = deps

  const repoKeys = repoQueryKeys(repository, { idle: tabId })

  const tabActiveRef = useRef(tabActive)
  useLayoutEffect(() => {
    tabActiveRef.current = tabActive
  }, [tabActive])

  const [fetchTick, setFetchTick] = useState(0)
  const pendingRefresh = useRef<RepoRef | null>(null)
  const lastFetchFailure = useRef<string | null>(null)
  const [lastFetch, setLastFetch] = useState<{
    repositoryKey: string
    fetchedAt: number
  } | null>(null)
  const lastFetchedAt =
    repository && lastFetch?.repositoryKey === repositoryIdentityKey(repository)
      ? lastFetch.fetchedAt
      : null

  const localBranchesQuery = useQuery({
    queryKey: repoKeys.localBranches,
    enabled: Boolean(repoPath),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: () => fetchLocalBranches(repoPath as string)
  })

  const remoteRefsQuery = useQuery({
    queryKey: repoKeys.remoteRefs,
    enabled: Boolean(repoPath) && Boolean(localBranchesQuery.data),
    gcTime: WARM_REOPEN_GC_TIME_MS,
    queryFn: () => fetchRemoteRefs(repoPath as string)
  })

  const branches = useMemo(
    () => combineBranches(localBranchesQuery.data, remoteRefsQuery.data),
    [localBranchesQuery.data, remoteRefsQuery.data]
  )

  const currentBranch = localBranchesQuery.data?.current || statusCurrent || ''
  const branchesLoading = localBranchesQuery.isFetching && !localBranchesQuery.data

  const notifyFetchBusy = () => {
    toast.info('Another Git action is still running', {
      description: 'Wait for it to finish, then fetch again.'
    })
  }

  const reportFetchFailure = (rawMessage: string, manual: boolean) => {
    const alreadyReported = lastFetchFailure.current === rawMessage
    lastFetchFailure.current = rawMessage
    if (manual || !alreadyReported) {
      toastGitFailure('Fetch failed', rawMessage)
    }
  }

  const runFetchAndRefresh = (candidate: RepoRef, manual = false) =>
    mutationCoordinator.run(
      'fetch',
      undefined,
      async () => {
        const generation = openGenerationRef.current
        if (!isCurrentRepo(generation, candidate)) {
          return
        }
        try {
          const response = await rpcFetch(candidate.path)
          if (!isCurrentRepo(generation, candidate)) {
            return
          }
          if (response._tag === 'Ok') {
            lastFetchFailure.current = null
            setLastFetch({
              repositoryKey: repositoryIdentityKey(candidate),
              fetchedAt: Date.now()
            })
            if (manual) {
              toast.success('Fetched from remote')
            }
            if (tabActiveRef.current) {
              await refreshAfterFetch(candidate)
            } else {
              pendingRefresh.current = candidate
            }
          } else if (response._tag === 'FetchSkipped') {
            if (manual) {
              toast.info('A fetch is already running')
            }
          } else if (response._tag === 'GitError') {
            reportFetchFailure(response.message, manual)
          }
        } catch (error) {
          if (isCurrentRepo(generation, candidate)) {
            toastEngineFailure('Fetch failed', formatCause(error))
          }
        }
      },
      manual ? notifyFetchBusy : undefined
    )

  const fetchNowImpl = async () => {
    const currentRepository = liveRepoRef.current
    if (!currentRepository) {
      return
    }
    setFetchTick((tick) => tick + 1)
    await runFetchAndRefresh(currentRepository, true)
  }

  const latest = useLatestRef({
    isTabActive: () => tabActiveRef.current,
    runFetchAndRefresh,
    fetchNow: fetchNowImpl,
    refreshAfterFetch
  })

  const fetchNow = useCallback(() => latest.current.fetchNow(), [])

  useEffect(() => {
    const pendingRepository = pendingRefresh.current
    if (
      !tabActive ||
      !repository ||
      !pendingRepository ||
      repositoryIdentityKey(pendingRepository) !== repositoryIdentityKey(repository)
    ) {
      return
    }
    pendingRefresh.current = null
    void latest.current.refreshAfterFetch(repository)
  }, [repository, tabActive])

  useEffect(() => {
    void fetchTick
    if (!repository) {
      return
    }
    const handle = window.setInterval(() => {
      const { isTabActive, runFetchAndRefresh } = latest.current
      if (isTabActive()) {
        void runFetchAndRefresh(repository)
      }
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [repository, fetchTick])

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
