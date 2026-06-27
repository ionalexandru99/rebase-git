import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, render, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, setupRepoChanged, sidecarMock } from '@/../test/setup'
import { useStashes } from '@/hooks/git/useStashes'
import { repoQueryKeys } from '@/lib/query-keys'
import { createQueryClient, QueryProvider } from '@/providers/QueryProvider'
import {
  GitStoreProvider,
  type RepoSession,
  useActionRunner,
  useCommitHistory,
  useRefs,
  useRepoSession,
  useWorkingTreeStatus
} from '@/stores/git'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const repoPath = '/home/user/project'
const otherRepoPath = '/home/user/other-project'

const openRepoOkFor = (path: string) => ({
  _tag: 'Ok' as const,
  result: {
    path,
    remotes: {},
    defaultBranch: 'main'
  }
})

const openRepoOk = openRepoOkFor(repoPath)

const statusOk = {
  _tag: 'Ok' as const,
  status: {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files: []
  }
}

const localBranchesOk = {
  _tag: 'Ok' as const,
  branches: {
    current: 'main',
    all: ['main', 'dev']
  }
}

const remoteRefsOk = {
  _tag: 'Ok' as const,
  refs: {
    remotes: ['origin/main'],
    tags: ['v1']
  }
}

// The fat store object is gone; these provider-level tests assert behavior across the concerns at
// once, so they read every focused context and assemble one view to assert against. This is test
// ergonomics only — each value still flows through the real per-tab provider and its contexts.
function useAggregateGit() {
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
    commit: actions.commit,
    fetchNow: refs.fetchNow,
    pushNow: actions.pushNow,
    pullNow: actions.pullNow,
    runAction: actions.runAction,
    loadMoreHistory: history.loadMoreHistory
  }
}

type AggregateGit = ReturnType<typeof useAggregateGit>

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

function GitStoreHarness(props: HarnessProps) {
  const [tabActive, setTabActive] = useState(props.initialTabActive)
  props.onSetTabActive(setTabActive)
  return (
    <GitStoreProvider tabId="test-tab" tabActive={tabActive}>
      <GitStoreProbe {...props} />
    </GitStoreProvider>
  )
}

function renderGitStore(initialTabActive = true) {
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
  // The store and its `state` are recreated every render now that `createStore` hands back a fresh
  // identity per update. Forward to the latest render's store, and after an awaited store method
  // settles, commit its pending re-render with an empty `act` so the next synchronous `state` read
  // (and the store's own onLogChunk/onRepoChanged handlers reading the live state) observe it —
  // restoring the synchronous semantics the old in-place mutation gave these tests. The empty `act`
  // only drains React's work queue; it never awaits the store's fire-and-forget promises, so it
  // cannot hang on the never-resolving log-stream restarts some tests set up.
  const git = new Proxy({} as AggregateGit, {
    get: (_target, prop) => {
      const value = latestGit?.[prop as keyof AggregateGit]
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        const result = (value as (...callArgs: unknown[]) => unknown).apply(latestGit, args)
        if (!(result instanceof Promise)) {
          return result
        }
        return result.then(
          async (resolved) => {
            await act(async () => {})
            return resolved
          },
          async (error) => {
            await act(async () => {})
            throw error
          }
        )
      }
    }
  })
  const session = new Proxy({} as RepoSession, {
    get: (_target, prop) => {
      const value = latestSession?.[prop as keyof RepoSession]
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        const result = (value as (...callArgs: unknown[]) => unknown).apply(latestSession, args)
        if (!(result instanceof Promise)) {
          return result
        }
        return result.then(
          async (resolved) => {
            await act(async () => {})
            return resolved
          },
          async (error) => {
            await act(async () => {})
            throw error
          }
        )
      }
    }
  })
  return { git, session, setTabActive, queryClient }
}

// Advance fake timers and commit the re-render the fired flush schedules, so the captured store
// observes it.
const advanceTimers = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

// A fake-timer test that fails before its own `vi.useRealTimers()` would otherwise leave fake
// timers active and hang `waitFor` in every later test.
afterEach(() => {
  vi.useRealTimers()
})

describe('GitStoreProvider — parallel repo loading', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
    vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({
      _tag: 'Ok'
    })
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
    setupLogStream()
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
    sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
  })

  it('openRepo kicks off parallel refreshes without blocking', async () => {
    let resolveLogStart: () => void = () => {}
    vi.mocked(window.electronAPI.startLogStream).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogStart = () => resolve({ _tag: 'Ok' })
        })
    )

    const { git, session } = renderGitStore()
    const initialGeneration = session.openGeneration
    const openPromise = session.openRepo(repoPath)

    await waitFor(() => {
      expect(session.opening).toBe(false)
      expect(session.repoPath).toBe(repoPath)
    })
    expect(session.openGeneration).toBeGreaterThan(initialGeneration)
    expect(git.state.repoPath).toBe(repoPath)

    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 0,
      maxCount: LOG_PAGE_SIZE,
      streamId: expect.any(Number)
    })

    resolveLogStart()
    await openPromise

    await waitFor(() => {
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
  })

  it('closes an obsolete repo open that resolves after the tab is closed', async () => {
    let resolveOpen: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = () => resolve(openRepoOk)
        })
    )

    const { session } = renderGitStore()
    const openPromise = session.openRepo(repoPath)

    await waitFor(() => {
      expect(session.opening).toBe(true)
    })
    const openingGeneration = session.openGeneration
    await session.closeRepo()
    expect(session.openGeneration).toBeGreaterThan(openingGeneration)
    resolveOpen()

    await expect(openPromise).resolves.toBeNull()
    await waitFor(() => {
      expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath)
    })
  })

  it('does not close the active repo when an obsolete same-path open resolves', async () => {
    let firstOpen = true
    let resolveFirstOpen: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementation((requestedPath) =>
      firstOpen
        ? new Promise((resolve) => {
            firstOpen = false
            resolveFirstOpen = () => resolve(openRepoOkFor(requestedPath))
          })
        : Promise.resolve(openRepoOkFor(requestedPath))
    )

    const { session } = renderGitStore()
    const obsoleteOpen = session.openRepo(repoPath)
    await waitFor(() => {
      expect(session.opening).toBe(true)
    })

    await expect(session.openRepo(repoPath)).resolves.toBe(repoPath)
    await waitFor(() => {
      expect(session.repoPath).toBe(repoPath)
    })

    resolveFirstOpen()
    await expect(obsoleteOpen).resolves.toBeNull()

    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(repoPath)
    await session.closeRepo()
  })

  it('closes the previous repo when switching repos succeeds', async () => {
    vi.mocked(window.electronAPI.openRepo).mockImplementation((requestedPath) =>
      Promise.resolve(openRepoOkFor(requestedPath))
    )

    const { session } = renderGitStore()
    await session.openRepo(repoPath)
    await waitFor(() => {
      expect(session.repoPath).toBe(repoPath)
    })

    await session.openRepo(otherRepoPath)

    expect(session.repoPath).toBe(otherRepoPath)
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath)
    await session.closeRepo()
  })

  it('ignores a stale log-stream error after switching repos', async () => {
    let resolveOldStream: (response: { _tag: 'GitError'; message: string }) => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementation((requestedPath) =>
      Promise.resolve(openRepoOkFor(requestedPath))
    )
    vi.mocked(window.electronAPI.startLogStream).mockImplementation((path) => {
      if (path === repoPath) {
        return new Promise((resolve) => {
          resolveOldStream = resolve
        })
      }
      return Promise.resolve({ _tag: 'Ok' })
    })

    const { session } = renderGitStore()
    await session.openRepo(repoPath)
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
        skip: 0,
        maxCount: LOG_PAGE_SIZE,
        streamId: expect.any(Number)
      })
    })

    await session.openRepo(otherRepoPath)
    await waitFor(() => {
      expect(session.repoPath).toBe(otherRepoPath)
    })

    await act(async () => {
      resolveOldStream({ _tag: 'GitError', message: 'old stream failed' })
    })

    expect(session.error).toBeNull()
    await session.closeRepo()
  })

  it('does not close the repo on a StrictMode transient unmount/remount', async () => {
    vi.useFakeTimers()
    let latestGit: AggregateGit | undefined
    let latestSession: RepoSession | undefined
    // StrictMode mounts, unmounts, then remounts the same instance on the first render. The
    // transient unmount queues the deferred close that the remount must cancel.
    render(
      <StrictMode>
        <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
          <GitStoreHarness
            initialTabActive={true}
            onGit={(store) => (latestGit = store)}
            onSession={(session) => (latestSession = session)}
            onSetTabActive={() => {}}
          />
        </QueryProvider>
      </StrictMode>
    )

    await act(async () => {
      await latestSession?.openRepo(repoPath)
    })

    // Drain the deferred-cleanup timer: if the remount failed to cancel it, closeRepo fires here.
    await advanceTimers(0)

    expect(latestSession?.repoPath).toBe(repoPath)
    expect(latestGit?.state.repoPath).toBe(repoPath)
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('local branches paint before log stream completes', async () => {
    vi.mocked(window.electronAPI.startLogStream).mockImplementation(() => new Promise(() => {}))
    sidecarMock.getLocalBranches.mockImplementation(async () => {
      return localBranchesOk
    })

    const { git } = renderGitStore()
    void git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })
    expect(git.state.logLoading).toBe(true)
  })

  it('local branches paint before remote refs arrive', async () => {
    let resolveRemote: () => void = () => {}
    sidecarMock.getRemoteRefs
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRemote = () => resolve(remoteRefsOk)
          })
      )
      .mockResolvedValue(remoteRefsOk)

    const { git } = renderGitStore()
    void git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
      expect(git.state.branchesLoading).toBe(false)
    })
    expect(git.state.branches?.remotes).toEqual([])

    resolveRemote()
    await waitFor(() => {
      expect(git.state.branches?.remotes).toEqual(['origin/main'])
      expect(git.state.branches?.tags).toEqual(['v1'])
    })
  })

  it('branchesLoading is false once local branches exist even while refetching', async () => {
    let resolveRefetch: () => void = () => {}
    sidecarMock.getLocalBranches.mockResolvedValueOnce(localBranchesOk).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefetch = () => resolve(localBranchesOk)
        })
    )

    const { git } = renderGitStore()
    void git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })

    // A branch action invalidates the branch caches through the runner, forcing a refetch.
    const refresh = git.runAction(
      'createBranch',
      () => Promise.resolve({ _tag: 'Ok' as const }),
      'Created'
    )

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(git.state.branchesLoading).toBe(false)
    })

    resolveRefetch()
    await refresh
  })

  it('checkout updates the current branch from fresh sidecar reads', async () => {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.currentBranch).toBe('main')
    })

    sidecarMock.getStatus.mockResolvedValue({
      _tag: 'Ok',
      status: { ...statusOk.status, current: 'dev' }
    })
    sidecarMock.getLocalBranches.mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'dev', all: ['main', 'dev'] }
    })

    await git.runAction(
      'checkout',
      () => Promise.resolve({ _tag: 'Ok' as const }),
      'Switched to dev'
    )

    await waitFor(() => {
      expect(git.state.currentBranch).toBe('dev')
      expect(git.state.branches?.current).toBe('dev')
    })
  })

  it('reflects a renamed current branch from a branch-only refresh while status lags', async () => {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.currentBranch).toBe('main')
    })

    // Renaming the checked-out branch refreshes branches only; status still reports the old name.
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'renamed', all: ['renamed', 'dev'] }
    })

    await git.runAction('renameBranch', () => Promise.resolve({ _tag: 'Ok' as const }), 'Renamed')

    await waitFor(() => {
      expect(git.state.currentBranch).toBe('renamed')
    })
    expect(git.state.status?.current).toBe('main')
  })

  it('log flush skipped when tab inactive', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const { git, setTabActive } = renderGitStore(true)

    await git.openRepo(repoPath)

    setTabActive(false)
    stream.fire({
      repoPath,
      commits: [
        {
          hash: 'abc123',
          message: 'Buffered commit',
          author_name: 'Test',
          date: '2026-01-01T00:00:00Z',
          parents: [],
          refs: ''
        }
      ]
    })

    await advanceTimers(200)
    expect(git.state.log?.all.length ?? 0).toBe(0)

    setTabActive(true)
    await advanceTimers(200)

    expect(git.state.log?.all.some((commit) => commit.message === 'Buffered commit')).toBe(true)

    vi.useRealTimers()
  })

  it('inactive tab flushes buffered commits on activate', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const { git, setTabActive } = renderGitStore(false)

    await git.openRepo(repoPath)

    stream.fire({
      repoPath,
      commits: [
        {
          hash: 'def456',
          message: 'Deferred commit',
          author_name: 'Test',
          date: '2026-01-01T00:00:00Z',
          parents: [],
          refs: ''
        }
      ]
    })

    setTabActive(true)
    await advanceTimers(200)

    expect(git.state.log?.all.some((commit) => commit.message === 'Deferred commit')).toBe(true)

    vi.useRealTimers()
  })

  it('flushes log updates while the sidebar is being resized', async () => {
    vi.useFakeTimers()
    document.body.dataset.sidebarResizing = 'true'
    const stream = setupLogStream()
    const { git } = renderGitStore()

    await git.openRepo(repoPath)

    stream.fire({
      repoPath,
      commits: [
        {
          hash: 'resize123',
          message: 'Buffered during resize',
          author_name: 'Test',
          date: '2026-01-01T00:00:00Z',
          parents: [],
          refs: ''
        }
      ]
    })

    await advanceTimers(200)
    expect(git.state.log?.all.some((commit) => commit.message === 'Buffered during resize')).toBe(
      true
    )

    delete document.body.dataset.sidebarResizing
    vi.useRealTimers()
  })

  it('discards an out-of-order status response that resolves after a newer one', async () => {
    const partialStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        modified: ['a.ts'],
        staged: ['a.ts'],
        files: [{ path: 'a.ts', index: 'M', working_dir: 'M' }]
      }
    }
    const stagedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        staged: ['a.ts'],
        files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
      }
    }

    let repoChanged: (event: { repoPath: string; kind: 'refs' | 'workingTree' }) => void = () => {}
    vi.mocked(window.electronAPI.onRepoChanged).mockImplementation((callback) => {
      repoChanged = callback
      return () => {}
    })
    sidecarMock.stageHunk.mockResolvedValue({ _tag: 'Ok' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
    })

    let resolveStale: () => void = () => {}
    sidecarMock.getStatus
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = () => resolve(partialStatus)
          })
      )
      .mockResolvedValue(stagedStatus)

    repoChanged({ repoPath, kind: 'workingTree' })
    await git.stageHunk('a.ts', '@@ -1,1 +1,1 @@')

    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: ' '
      })
    })

    resolveStale()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(git.state.status?.files?.[0]).toEqual({
      path: 'a.ts',
      index: 'M',
      working_dir: ' '
    })
  })

  it('optimistically marks a file staged when staging its final hunk', async () => {
    const partialStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        modified: ['a.ts'],
        staged: ['a.ts'],
        files: [{ path: 'a.ts', index: 'M', working_dir: 'M' }]
      }
    }
    const stagedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        staged: ['a.ts'],
        files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
      }
    }
    let resolveStageHunk: () => void = () => {}

    sidecarMock.getStatus.mockResolvedValueOnce(partialStatus).mockResolvedValue(stagedStatus)
    sidecarMock.stageHunk.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStageHunk = () => resolve({ _tag: 'Ok' })
        })
    )

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: 'M'
      })
    })

    let stagePromise: Promise<boolean> | undefined
    // stageHunk applies its optimistic status update synchronously; commit it so the read below
    // observes the optimistic state before the in-flight mutation resolves.
    await act(async () => {
      stagePromise = git.stageHunk('a.ts', '@@ -1,1 +1,1 @@', { fullyStagesFile: true })
    })

    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({
        path: 'a.ts',
        index: 'M',
        working_dir: ' '
      })
    })
    expect(git.state.status?.modified).toEqual([])
    expect(git.state.status?.staged).toEqual(['a.ts'])

    resolveStageHunk()
    await stagePromise

    expect(git.state.status?.files?.[0]).toEqual({
      path: 'a.ts',
      index: 'M',
      working_dir: ' '
    })
  })

  it('stageFile optimistically stages then confirms from the sidecar', async () => {
    const modifiedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        modified: ['a.ts'],
        files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
      }
    }
    const stagedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        staged: ['a.ts'],
        files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
      }
    }
    sidecarMock.getStatus.mockResolvedValueOnce(modifiedStatus).mockResolvedValue(stagedStatus)
    let resolveStage: () => void = () => {}
    sidecarMock.stageFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStage = () => resolve({ _tag: 'Ok' })
        })
    )

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({ path: 'a.ts', index: ' ', working_dir: 'M' })
    })

    let stagePromise: Promise<unknown> | undefined
    await act(async () => {
      stagePromise = git.stageFile('a.ts')
    })

    await waitFor(() => {
      expect(git.state.status?.staged).toEqual(['a.ts'])
      expect(git.state.status?.modified).toEqual([])
    })

    resolveStage()
    await stagePromise
    await waitFor(() => {
      expect(git.state.status?.files?.[0]).toEqual({ path: 'a.ts', index: 'M', working_dir: ' ' })
    })
  })

  it('rolls the optimistic stage back when the sidecar rejects it', async () => {
    const modifiedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        modified: ['a.ts'],
        files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
      }
    }
    sidecarMock.getStatus.mockResolvedValue(modifiedStatus)
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'GitError', message: 'cannot stage' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['a.ts'])
    })

    await git.stageFile('a.ts')

    await waitFor(() => {
      expect(git.state.error).toBe('cannot stage')
    })
    expect(git.state.status?.staged).toEqual([])
    expect(git.state.status?.modified).toEqual(['a.ts'])
  })

  it('re-syncs status after a failed hunk op (stale diff)', async () => {
    sidecarMock.stageHunk.mockResolvedValue({ _tag: 'GitError', message: 'hunk gone' })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
    })

    sidecarMock.getStatus.mockClear()
    const ok = await git.stageHunk('a.ts', '@@ -1,1 +1,1 @@')

    expect(ok).toBe(false)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })
    expect(git.state.error).toBe('hunk gone')
  })

  it('reads server state from the query cache (cache is the source of truth)', async () => {
    const { git, queryClient } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    // The facade is a projection of the cache: writing the status key directly must surface in
    // git.state with no separate mirror to keep in sync.
    const before = git.state
    act(() => {
      queryClient.setQueryData(repoQueryKeys(repoPath).status, {
        ...statusOk.status,
        modified: ['only-in-cache.ts']
      })
    })

    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['only-in-cache.ts'])
    })
    expect(git.state).not.toBe(before)
    expect(queryClient.getQueryData(repoQueryKeys(repoPath).status)).toBe(git.state.status)
  })

  it('repaints from the warm cache when a repo is closed and reopened', async () => {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status).not.toBeNull()
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })

    await git.closeRepo()
    await waitFor(() => {
      expect(git.state.repoPath).toBeNull()
    })

    // The fresh fetches hang on reopen, so only the warm cache (kept past close via gcTime) can
    // paint status and branches.
    sidecarMock.getStatus.mockImplementation(() => new Promise(() => {}))
    sidecarMock.getLocalBranches.mockImplementation(() => new Promise(() => {}))
    void git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
      expect(git.state.status).not.toBeNull()
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })
  })

  it('commit refreshes status and restarts the log stream on success', async () => {
    sidecarMock.commit.mockResolvedValue({
      _tag: 'Ok',
      result: {
        commit: 'abc1234',
        branch: 'main',
        summary: { changes: 1, insertions: 1, deletions: 0 }
      }
    })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    const committed = await git.commit('a message')

    expect(committed).toBe(true)
    expect(sidecarMock.commit).toHaveBeenCalledWith(repoPath, 'a message')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Committed')
    expect(git.state.committing).toBe(false)
  })

  it('rolls back and surfaces the error when staging throws', async () => {
    const modifiedStatus = {
      _tag: 'Ok' as const,
      status: {
        ...statusOk.status,
        modified: ['a.ts'],
        files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }]
      }
    }
    sidecarMock.getStatus.mockResolvedValue(modifiedStatus)
    sidecarMock.stageFile.mockRejectedValue(new Error('network down'))

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.status?.modified).toEqual(['a.ts'])
    })

    await git.stageFile('a.ts').catch(() => {})

    await waitFor(() => {
      expect(git.state.error).toBe('network down')
    })
    expect(git.state.status?.staged).toEqual([])
    expect(git.state.status?.modified).toEqual(['a.ts'])
  })

  it('loadMoreHistory requests the next page without clearing existing commits', async () => {
    const stream = setupLogStream()
    const { git } = renderGitStore()

    await git.openRepo(repoPath)

    stream.fire({
      repoPath,
      commits: [
        {
          hash: 'page1',
          message: 'Page one',
          author_name: 'Test',
          date: '2026-01-01T00:00:00Z',
          parents: [],
          refs: ''
        }
      ]
    })
    stream.fireDone(repoPath, true)

    await waitFor(() => {
      expect(git.state.logHasMore).toBe(true)
    })

    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await git.loadMoreHistory()

    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 1,
      maxCount: LOG_PAGE_SIZE,
      streamId: expect.any(Number)
    })
    expect(git.state.logLoadingMore).toBe(true)

    stream.fire({
      repoPath,
      commits: [
        {
          hash: 'page2',
          message: 'Page two',
          author_name: 'Test',
          date: '2026-01-01T00:00:00Z',
          parents: ['page1'],
          refs: ''
        }
      ]
    })
    stream.fireDone(repoPath, false)

    await waitFor(() => {
      expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['Page one', 'Page two'])
      expect(git.state.logHasMore).toBe(false)
      expect(git.state.logLoadingMore).toBe(false)
    })
  })

  it('routes a repo-changed(refs) event through the live store after open', async () => {
    let repoChanged: (event: { repoPath: string; kind: 'refs' | 'workingTree' }) => void = () => {}
    vi.mocked(window.electronAPI.onRepoChanged).mockImplementation((callback) => {
      repoChanged = callback
      return () => {}
    })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
    })

    // The subscription registered at render zero, when repoPath was null. Reading the live store
    // through the latest ref is what lets the refs handler pass its repoPath guard and refresh
    // branches even though the store object's identity has since changed.
    sidecarMock.getLocalBranches.mockClear()
    repoChanged({ repoPath, kind: 'refs' })

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    })
  })
})

describe('GitStoreProvider — push and pull', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
    vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({
      _tag: 'Ok'
    })
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
    setupLogStream()
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
    sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
  })

  it('pushNow refreshes branches and clears the pushing flag on success', async () => {
    sidecarMock.pushRepo.mockResolvedValue({ _tag: 'Ok' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getLocalBranches.mockClear()
    await git.pushNow()

    expect(sidecarMock.pushRepo).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(toast.success).toHaveBeenCalledWith('Pushed')
    expect(git.state.pushing).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('reflects only the in-flight action’s pending flag', async () => {
    let resolvePush: () => void = () => {}
    sidecarMock.pushRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ _tag: 'Ok' })
        })
    )
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    const pushPromise = git.pushNow()
    await waitFor(() => expect(git.state.pushing).toBe(true))
    expect(git.state.committing).toBe(false)
    expect(git.state.pulling).toBe(false)

    resolvePush()
    await pushPromise
    await waitFor(() => expect(git.state.pushing).toBe(false))
  })

  it('pushNow toasts a GitError without touching session error', async () => {
    sidecarMock.pushRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'no upstream'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pushNow()

    expect(toast.error).toHaveBeenCalledWith('Pushed failed', { description: 'no upstream' })
    expect(git.state.error).toBeNull()
    expect(git.state.pushing).toBe(false)
  })

  it('ignores a stale push error after switching repos', async () => {
    vi.mocked(window.electronAPI.openRepo).mockImplementation((requestedPath) =>
      Promise.resolve(openRepoOkFor(requestedPath))
    )
    let resolvePush: () => void = () => {}
    sidecarMock.pushRepo.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePush = () => resolve({ _tag: 'GitError', message: 'old push failed' })
        })
    )

    const { git, session } = renderGitStore()
    await session.openRepo(repoPath)
    await waitFor(() => expect(session.repoPath).toBe(repoPath))

    const pushPromise = git.pushNow()
    await waitFor(() => {
      expect(git.state.pushing).toBe(true)
    })
    await session.openRepo(otherRepoPath)

    resolvePush()
    await pushPromise

    expect(session.repoPath).toBe(otherRepoPath)
    expect(session.error).toBeNull()
    await session.closeRepo()
  })

  it('pullNow refreshes status and restarts the log stream on success', async () => {
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    sidecarMock.getStatus.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await git.pullNow()

    expect(sidecarMock.pullRepo).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Pulled')
    expect(git.state.pulling).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('pullNow toasts a GitError without touching session error', async () => {
    sidecarMock.pullRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'not fast-forward'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pullNow()

    expect(toast.error).toHaveBeenCalledWith('Pulled failed', { description: 'not fast-forward' })
    expect(git.state.error).toBeNull()
    expect(git.state.pulling).toBe(false)
  })
})

const makeCommit = (hash: string, message: string, parents: string[] = []) => ({
  hash,
  message,
  author_name: 'Test',
  date: '2026-01-01T00:00:00Z',
  parents,
  refs: ''
})

function StashProbe(props: { onGit: (git: AggregateGit) => void }) {
  const git = useAggregateGit()
  const session = useRepoSession()
  useStashes(session.repoPath)
  props.onGit(git)
  return null
}

function StashHarness(props: { onGit: (git: AggregateGit) => void }) {
  return (
    <GitStoreProvider tabId="test-tab" tabActive={true}>
      <StashProbe {...props} />
    </GitStoreProvider>
  )
}

describe('GitStoreProvider — Phase 2 streaming + watcher', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
    vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    setupLogStream()
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
    sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
    sidecarMock.pullRepo.mockResolvedValue({ _tag: 'Ok' })
  })

  it('restarts the log stream and refreshes branches on an external refs change', async () => {
    const repoChanged = setupRepoChanged()
    setupLogStream()
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    vi.mocked(window.electronAPI.startLogStream).mockClear()
    sidecarMock.getLocalBranches.mockClear()
    repoChanged.fire({ repoPath, kind: 'refs' })

    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalled()
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    })
  })

  it('drops log chunks from a superseded stream generation', async () => {
    const stream = setupLogStream()
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    stream.fire({ repoPath, streamId: 1, commits: [makeCommit('c1', 'first')] })
    stream.fireDone(repoPath, false)
    await waitFor(() => {
      expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['first'])
    })

    // pullNow restarts the stream, bumping the generation and clearing the log.
    await git.pullNow()

    stream.fire({ repoPath, streamId: 1, commits: [makeCommit('stale', 'stale-generation')] })
    stream.fire({ repoPath, streamId: 2, commits: [makeCommit('c2', 'second')] })
    stream.fireDone(repoPath, false)

    await waitFor(() => {
      expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['second'])
    })
  })

  it('computes load-more skip from the buffer when the store flush lags', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const { git, setTabActive } = renderGitStore(true)
    await git.openRepo(repoPath)

    setTabActive(false)
    stream.fire({ repoPath, commits: [makeCommit('a', 'A'), makeCommit('b', 'B')] })
    stream.fireDone(repoPath, true)
    await advanceTimers(200)

    expect(git.state.log?.all.length ?? 0).toBe(0)

    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await git.loadMoreHistory()

    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 2,
      maxCount: LOG_PAGE_SIZE,
      streamId: expect.any(Number)
    })

    setTabActive(true)
    vi.useRealTimers()
  })

  it('invalidates the stash list on a working-tree change', async () => {
    const repoChanged = setupRepoChanged()
    setupLogStream()
    let latestGit: AggregateGit | undefined
    renderWithQuery(() => <StashHarness onGit={(git) => (latestGit = git)} />)

    await act(async () => {
      await latestGit?.openRepo(repoPath)
    })
    await waitFor(() => {
      expect(sidecarMock.stashList).toHaveBeenCalledWith(repoPath)
    })

    const callsAfterOpen = sidecarMock.stashList.mock.calls.length
    repoChanged.fire({ repoPath, kind: 'workingTree' })

    await waitFor(() => {
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(callsAfterOpen)
    })
  })
})

describe('GitStoreProvider — runAction', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
    vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    setupLogStream()
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
    sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
  })

  async function openedStore() {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => {
      expect(git.state.repoPath).toBe(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    sidecarMock.getRemoteRefs.mockClear()
    return git
  }

  it('invalidates exactly the mapped caches and toasts success on Ok', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(true)
    expect(call).toHaveBeenCalledWith(repoPath)
    expect(toast.success).toHaveBeenCalledWith('Deleted branch feature')
    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('toasts the failure and invalidates nothing on a Git error', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'GitError', message: 'branch not found' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Deleted branch feature failed', {
      description: 'branch not found'
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('reports a RepoNotOpen response as repo-not-open and invalidates nothing', async () => {
    const git = await openedStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'RepoNotOpen' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Repository is not open')
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
  })

  it('reports a closed repo and never calls the op when no repo is open', async () => {
    const { git } = renderGitStore()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('deleteBranch', call, 'Deleted branch feature')

    expect(ok).toBe(false)
    expect(call).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Repository is not open')
  })

  it('routes a conflictable op Conflict to the resolve path and refreshes its mapped caches', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Conflict', message: 'merge stopped' })
    const ok = await git.runAction('mergeBranch', call, 'Merged feature')

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
  })

  it('refreshes only branches for a plain create-branch — not the working tree or timeline', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('createBranch', call, 'Created branch feature')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('refreshes the working tree, branches, and timeline for a create+checkout', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('createBranchCheckout', call, 'Created and switched to feature')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
  })

  it('refreshes only the working tree for a discard — not branches or the timeline', async () => {
    const git = await openedStore()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    const ok = await git.runAction('discardChanges', call, 'Discarded changes')

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    })
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getRemoteRefs).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })
})

describe('GitStoreProvider — runAction stash caches', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openRepoOk)
    vi.mocked(window.electronAPI.startLogStream).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({})
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
    setupLogStream()
    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(localBranchesOk)
    sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsOk)
    sidecarMock.stashList.mockResolvedValue({ _tag: 'Ok', stashes: [] })
  })

  async function openedStashStore() {
    const ref: { git?: AggregateGit } = {}
    renderWithQuery(() => <StashHarness onGit={(git) => (ref.git = git)} />)
    await act(async () => {
      await ref.git?.openRepo(repoPath)
    })
    await waitFor(() => {
      expect(sidecarMock.stashList).toHaveBeenCalledWith(repoPath)
    })
    sidecarMock.getStatus.mockClear()
    sidecarMock.getLocalBranches.mockClear()
    sidecarMock.getRemoteRefs.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    return ref
  }

  it('refreshes only the stash list for a stash drop', async () => {
    const ref = await openedStashStore()
    const stashListCalls = sidecarMock.stashList.mock.calls.length

    const call = vi.fn().mockResolvedValue({ _tag: 'Ok' })
    let ok: boolean | undefined
    await act(async () => {
      ok = await ref.git?.runAction('stashDrop', call, 'Dropped stash')
    })

    expect(ok).toBe(true)
    await waitFor(() => {
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(stashListCalls)
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('routes a stash apply Conflict to the resolve path and refreshes the working tree and stash', async () => {
    const ref = await openedStashStore()
    const stashListCalls = sidecarMock.stashList.mock.calls.length

    const call = vi.fn().mockResolvedValue({ _tag: 'Conflict', message: 'stash conflicts' })
    let ok: boolean | undefined
    await act(async () => {
      ok = await ref.git?.runAction('stashApply', call, 'Applied stash')
    })

    expect(ok).toBe(false)
    expect(toast.warning).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(stashListCalls)
    })
    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })
})
