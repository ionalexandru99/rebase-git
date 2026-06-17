import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, sidecarMock } from '@/../test/setup'
import { type Accessor, createSignal } from '@/lib/react-compat'
import { type GitStore, useGitStore } from '@/stores/git'

const repoPath = '/home/user/project'

const openRepoOk = {
  _tag: 'Ok' as const,
  result: {
    path: repoPath,
    remotes: {},
    defaultBranch: 'main'
  }
}

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
    renamed: []
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

interface HarnessProps {
  tabActive: Accessor<boolean>
  onGit: (git: GitStore) => void
}

function GitStoreHarness(props: HarnessProps) {
  const git = useGitStore('test-tab', props.tabActive)
  props.onGit(git)
  return null
}

function renderGitStore(tabActive = createSignal(true)) {
  let latestGit: GitStore | undefined
  renderWithQuery(() => (
    <GitStoreHarness tabActive={tabActive[0]} onGit={(store) => (latestGit = store)} />
  ))
  if (!latestGit) {
    throw new Error('git store not initialized')
  }
  // The store and its `state` are recreated every render now that `createStore` hands back a fresh
  // identity per update. Forward to the latest render's store, and after an awaited store method
  // settles, commit its pending re-render with an empty `act` so the next synchronous `state` read
  // (and the store's own onLogChunk/onRepoChanged handlers reading the live state) observe it —
  // restoring the synchronous semantics the old in-place mutation gave these tests. The empty `act`
  // only drains React's work queue; it never awaits the store's fire-and-forget promises, so it
  // cannot hang on the never-resolving log-stream restarts some tests set up.
  const git = new Proxy({} as GitStore, {
    get: (_target, prop) => {
      const value = latestGit?.[prop as keyof GitStore]
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        const result = (value as (...callArgs: unknown[]) => unknown).apply(latestGit, args)
        if (!(result instanceof Promise)) {
          return result
        }
        return result.then(async (resolved) => {
          await act(async () => {})
          return resolved
        })
      }
    }
  })
  return { git, tabActive }
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

describe('useGitStore — parallel repo loading', () => {
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

    const { git } = renderGitStore()
    const openPromise = git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.opening).toBe(false)
      expect(git.state.repoPath).toBe(repoPath)
    })

    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 0,
      maxCount: LOG_PAGE_SIZE
    })

    resolveLogStart()
    await openPromise

    await waitFor(() => {
      expect(sidecarMock.getRemoteRefs).toHaveBeenCalledWith(repoPath)
    })
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

  it('falls back to get-branches when split local op is rejected', async () => {
    sidecarMock.getLocalBranches.mockRejectedValue(new Error('invalid sidecar request'))
    sidecarMock.getBranches.mockResolvedValue({
      _tag: 'Ok',
      branches: {
        current: 'main',
        all: ['main', 'dev'],
        remotes: ['origin/main'],
        tags: ['v1']
      }
    })

    const { git } = renderGitStore()
    void git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
      expect(git.state.branches?.remotes).toEqual(['origin/main'])
    })
    expect(sidecarMock.getBranches).toHaveBeenCalledWith(repoPath)
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

    git.invalidateRepoQueries(repoPath)

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(git.state.branchesLoading).toBe(false)
    })

    resolveRefetch()
  })

  it('refreshAfterCheckout updates the current branch from fresh sidecar reads', async () => {
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

    await git.refreshAfterCheckout(repoPath)

    expect(git.state.currentBranch).toBe('dev')
    expect(git.state.branches?.current).toBe('dev')
  })

  it('log flush skipped when tab inactive', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const tabActive = createSignal(true)
    const { git, tabActive: active } = renderGitStore(tabActive)

    await git.openRepo(repoPath)

    active[1](false)
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

    active[1](true)
    await advanceTimers(200)

    expect(git.state.log?.all.some((commit) => commit.message === 'Buffered commit')).toBe(true)

    vi.useRealTimers()
  })

  it('inactive tab flushes buffered commits on activate', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const tabActive = createSignal(false)
    const { git, tabActive: active } = renderGitStore(tabActive)

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

    active[1](true)
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

    expect(git.state.status?.files?.[0]).toEqual({
      path: 'a.ts',
      index: 'M',
      working_dir: ' '
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
      maxCount: LOG_PAGE_SIZE
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

describe('useGitStore — push and pull', () => {
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
    expect(git.state.pushing).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('pushNow surfaces a GitError as state.error', async () => {
    sidecarMock.pushRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'no upstream'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pushNow()

    expect(git.state.error).toBe('no upstream')
    expect(git.state.pushing).toBe(false)
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
    expect(git.state.pulling).toBe(false)
    expect(git.state.error).toBeNull()
  })

  it('pullNow surfaces a GitError as state.error', async () => {
    sidecarMock.pullRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'not fast-forward'
    })
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    await git.pullNow()

    expect(git.state.error).toBe('not fast-forward')
    expect(git.state.pulling).toBe(false)
  })
})
