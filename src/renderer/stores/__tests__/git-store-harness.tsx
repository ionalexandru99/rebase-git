import { act } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, vi } from 'vitest'
import { createQueryClient } from '@/app/QueryProvider'
import {
  GitStoreProvider,
  type RepoSession,
  useActionRunner,
  useCommitHistory,
  useRefs,
  useRepoSession,
  useWorkingTreeStatus
} from '@/stores/git'
import {
  localBranchesResponse,
  openedRepoResponse,
  remoteRefsResponse,
  statusResponse
} from '../../../test/builders'
import { renderWithQuery } from '../../../test/render-app'
import { setupLogStream, sidecarMock } from '../../../test/setup'

export const repoPath = '/home/user/project'
export const otherRepoPath = '/home/user/other-project'
export const openRepoOkFor = (path: string) => openedRepoResponse(path)
export const openRepoOk = openRepoOkFor(repoPath)
export const statusOk = statusResponse()
export const localBranchesOk = localBranchesResponse({ all: ['main', 'dev'] })
export const remoteRefsOk = remoteRefsResponse({ remotes: ['origin/main'], tags: ['v1'] })

export function prepareGitStoreMocks(options: { pull?: boolean; stashes?: boolean } = {}) {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
  vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
  vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusOk)
  sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
  sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
  if (options.pull) {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
  }
  if (options.stashes) {
    sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
  }
}

afterEach(() => {
  vi.useRealTimers()
})

export function useAggregateGit() {
  const session = useRepoSession()
  const workingTree = useWorkingTreeStatus()
  const history = useCommitHistory()
  const refs = useRefs()
  const actions = useActionRunner()
  return {
    state: {
      repoPath: session.repoPath,
      status: workingTree.status,
      log: history.log,
      branches: refs.branches,
      remotes: refs.remotes,
      defaultBranch: refs.defaultBranch,
      currentBranch: refs.currentBranch,
      opening: session.opening,
      committing: actions.committing,
      pushing: actions.pushing,
      pulling: actions.pulling,
      statusLoading: workingTree.statusLoading,
      branchesLoading: refs.branchesLoading,
      logLoading: history.logLoading,
      logLoadingMore: history.logLoadingMore,
      logHasMore: history.logHasMore,
      lastFetchedAt: refs.lastFetchedAt,
      error: session.error
    },
    openRepo: session.openRepo,
    closeRepo: session.closeRepo,
    stageFile: workingTree.stageFile,
    unstageFile: workingTree.unstageFile,
    stageAll: workingTree.stageAll,
    unstageAll: workingTree.unstageAll,
    stageHunk: workingTree.stageHunk,
    unstageHunk: workingTree.unstageHunk,
    stageLines: workingTree.stageLines,
    commit: actions.commit,
    amend: actions.amend,
    fetchNow: refs.fetchNow,
    pushNow: actions.pushNow,
    pullNow: actions.pullNow,
    pull: actions.pull,
    runAction: actions.runAction,
    loadMoreHistory: history.loadMoreHistory
  }
}

export type AggregateGit = ReturnType<typeof useAggregateGit>

interface HarnessProps {
  initialTabActive: boolean
  onGit: (git: AggregateGit) => void
  onSession: (session: RepoSession) => void
  onSetTabActive: (setTabActive: (next: boolean) => void) => void
}

function GitStoreProbe(props: HarnessProps) {
  const git = useAggregateGit()
  const session = useRepoSession()
  props.onGit(git)
  props.onSession(session)
  return null
}

export function GitStoreHarness(props: HarnessProps) {
  const [tabActive, setTabActive] = useState(props.initialTabActive)
  props.onSetTabActive(setTabActive)
  return (
    <GitStoreProvider tabId="test-tab" tabActive={tabActive}>
      <GitStoreProbe {...props} />
    </GitStoreProvider>
  )
}

function createActProxy<T extends object>(latest: () => T | undefined): T {
  return new Proxy({} as T, {
    get: (_target, prop) => {
      const current = latest()
      const value = current?.[prop as keyof T]
      if (typeof value !== 'function') {
        return value
      }
      return async (...args: unknown[]) => {
        let result: unknown
        await act(async () => {
          result = await (value as (...callArgs: unknown[]) => unknown).apply(current, args)
        })
        return result
      }
    }
  })
}

function startCall<T extends object, Result>(
  current: () => T | undefined,
  call: (value: T) => Promise<Result>
): Promise<Result> {
  let result: Promise<Result> | undefined
  act(() => {
    const value = current()
    if (!value) {
      throw new Error('store not initialized')
    }
    result = call(value)
  })
  if (!result) {
    throw new Error('call did not start')
  }
  return result
}

export function renderGitStore(initialTabActive = true) {
  const queryClient = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
  let latestGit: AggregateGit | undefined
  let latestSession: RepoSession | undefined
  let latestSetTabActive: ((next: boolean) => void) | undefined
  renderWithQuery(
    () => (
      <GitStoreHarness
        initialTabActive={initialTabActive}
        onGit={(store) => (latestGit = store)}
        onSession={(session) => (latestSession = session)}
        onSetTabActive={(setTabActive) => (latestSetTabActive = setTabActive)}
      />
    ),
    queryClient
  )
  if (!latestGit || !latestSession || !latestSetTabActive) {
    throw new Error('git store not initialized')
  }
  const setTabActive = (next: boolean) => {
    act(() => {
      latestSetTabActive?.(next)
    })
  }
  const git = createActProxy(() => latestGit)
  const session = createActProxy(() => latestSession)
  const startGitCall = <Result,>(call: (value: AggregateGit) => Promise<Result>) =>
    startCall(() => latestGit, call)
  const startSessionCall = <Result,>(call: (value: RepoSession) => Promise<Result>) =>
    startCall(() => latestSession, call)
  return { git, session, setTabActive, queryClient, startGitCall, startSessionCall }
}

export const advanceTimers = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
