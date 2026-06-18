import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, setupRepoChanged, sidecarMock } from '@/../test/setup'
import { useStashes } from '@/hooks/git/useStashes'
import { repoQueryKeys } from '@/lib/query-keys'
import { createQueryClient } from '@/providers/QueryProvider'
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

interface HarnessProps {
  initialTabActive: boolean
  onGit: (git: GitStore) => void
  onSetTabActive: (setTabActive: (next: boolean) => void) => void
}

function GitStoreHarness(props: HarnessProps) {
  const [tabActive, setTabActive] = useState(props.initialTabActive)
  props.onSetTabActive(setTabActive)
  const git = useGitStore('test-tab', tabActive)
  props.onGit(git)
  return null
}

function renderGitStore(initialTabActive = true) {
  const queryClient = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
  let latestGit: GitStore | undefined
  let latestSetTabActive: ((next: boolean) => void) | undefined
  renderWithQuery(
    () => (
      <GitStoreHarness
        initialTabActive={initialTabActive}
        onGit={(store) => (latestGit = store)}
        onSetTabActive={(setTabActive) => (latestSetTabActive = setTabActive)}
      />
    ),
    queryClient
  )
  if (!latestGit || !latestSetTabActive) {
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
  return { git, setTabActive, queryClient }
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

    const { git } = renderGitStore()
    const openPromise = git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.opening).toBe(true)
    })
    await git.closeRepo()
    resolveOpen()

    await expect(openPromise).resolves.toBeNull()
    await waitFor(() => {
      expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath)
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

    await git.refreshBranchesOnly(repoPath)

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
    vi.mocked(window.electronAPI.startLogStream).mockClear()
    const committed = await git.commit('a message')

    expect(committed).toBe(true)
    expect(sidecarMock.commit).toHaveBeenCalledWith(repoPath, 'a message')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith(repoPath)
    expect(window.electronAPI.startLogStream).toHaveBeenCalled()
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

const makeCommit = (hash: string, message: string, parents: string[] = []) => ({
  hash,
  message,
  author_name: 'Test',
  date: '2026-01-01T00:00:00Z',
  parents,
  refs: ''
})

function StashHarness(props: { onGit: (git: GitStore) => void }) {
  const git = useGitStore('test-tab', true)
  useStashes(git.state.repoPath)
  props.onGit(git)
  return null
}

describe('useGitStore — Phase 2 streaming + watcher', () => {
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
    let latestGit: GitStore | undefined
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
