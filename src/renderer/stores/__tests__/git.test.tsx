import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { waitFor } from '@solidjs/testing-library'
import { type Accessor, createSignal } from 'solid-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { setupLogStream, sidecarMock } from '@/../test/setup'
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
  let git: GitStore | undefined
  renderWithQuery(() => (
    <GitStoreHarness tabActive={tabActive[0]} onGit={(store) => (git = store)} />
  ))
  if (!git) {
    throw new Error('git store not initialized')
  }
  return { git, tabActive }
}

describe('useGitStore — parallel repo loading', () => {
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

    await vi.advanceTimersByTimeAsync(200)
    expect(git.state.log?.all.length ?? 0).toBe(0)

    active[1](true)
    await vi.advanceTimersByTimeAsync(200)

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
    await vi.advanceTimersByTimeAsync(200)

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

    await vi.advanceTimersByTimeAsync(200)
    expect(git.state.log?.all.some((commit) => commit.message === 'Buffered during resize')).toBe(
      true
    )

    delete document.body.dataset.sidebarResizing
    vi.useRealTimers()
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
})
