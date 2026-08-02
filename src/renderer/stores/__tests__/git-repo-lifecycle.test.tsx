import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient, QueryProvider } from '@/app/QueryProvider'
import type { RepoSession } from '@/stores/git'
import { localBranchesResponse, statusResponse } from '../../../test/builders'
import { sidecarMock } from '../../../test/setup'
import {
  type AggregateGit,
  advanceTimers,
  GitStoreHarness,
  localBranchesOk,
  openRepoOk,
  openRepoOkFor,
  otherRepoPath,
  prepareGitStoreMocks,
  remoteRefsOk,
  renderGitStore,
  repoPath,
  statusOk
} from './git-store-harness'

describe('GitStoreProvider — repo lifecycle and loading', () => {
  beforeEach(() => {
    prepareGitStoreMocks()
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
    await session.openRepo(repoPath)

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

    await act(async () => resolveLogStart())

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

    const { session, startSessionCall } = renderGitStore()
    const openPromise = startSessionCall((current) => current.openRepo(repoPath))

    await waitFor(() => {
      expect(session.opening).toBe(true)
    })
    const openingGeneration = session.openGeneration
    await session.closeRepo()
    expect(session.openGeneration).toBeGreaterThan(openingGeneration)
    await act(async () => {
      resolveOpen()
      await expect(openPromise).resolves.toBeNull()
    })
    await waitFor(() => {
      expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath, expect.any(Number))
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

    const { session, startSessionCall } = renderGitStore()
    const obsoleteOpen = startSessionCall((current) => current.openRepo(repoPath))
    await waitFor(() => {
      expect(session.opening).toBe(true)
    })

    await expect(session.openRepo(repoPath)).resolves.toBe(repoPath)
    await waitFor(() => {
      expect(session.repoPath).toBe(repoPath)
    })

    await act(async () => {
      resolveFirstOpen()
      await expect(obsoleteOpen).resolves.toBeNull()
    })

    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(repoPath, expect.any(Number))
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
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath, expect.any(Number))
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

    await advanceTimers(0)

    expect(latestSession?.repoPath).toBe(repoPath)
    expect(latestGit?.state.repoPath).toBe(repoPath)
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('does not let a closed tab tear down the same repo after another tab reopens it', async () => {
    vi.useFakeTimers()
    let firstSession: RepoSession | undefined
    const firstRender = render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (firstSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    await act(async () => {
      await firstSession?.openRepo(repoPath)
    })
    vi.mocked(window.electronAPI.closeRepo).mockClear()
    firstRender.unmount()

    let reopenedSession: RepoSession | undefined
    render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (reopenedSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    await act(async () => {
      await reopenedSession?.openRepo(repoPath)
    })
    await advanceTimers(0)

    expect(reopenedSession?.repoPath).toBe(repoPath)
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(repoPath, expect.any(Number))
  })

  it('does not delay one repo cleanup while a different repo is opening', async () => {
    vi.useFakeTimers()
    vi.mocked(window.electronAPI.openRepo).mockResolvedValueOnce(openRepoOk)
    let resolveOtherOpen: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOtherOpen = () => resolve(openRepoOkFor(otherRepoPath))
        })
    )
    let firstSession: RepoSession | undefined
    const firstRender = render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (firstSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    await act(async () => {
      await firstSession?.openRepo(repoPath)
    })
    vi.mocked(window.electronAPI.closeRepo).mockClear()
    firstRender.unmount()

    let otherSession: RepoSession | undefined
    const otherRender = render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (otherSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    let otherOpen: Promise<string | null> | undefined
    act(() => {
      otherOpen = otherSession?.openRepo(otherRepoPath)
    })
    await advanceTimers(0)

    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith(repoPath, expect.any(Number))

    await act(async () => {
      resolveOtherOpen()
      await otherOpen
    })
    await act(async () => {
      await otherSession?.closeRepo()
    })
    otherRender.unmount()
  })

  it('holds a canonical deferred close while a known alias resolves to that repo', async () => {
    vi.useFakeTimers()
    const aliasPath = '/home/user/project-link'
    let resolveAlias: () => void = () => {}
    vi.mocked(window.electronAPI.openRepo)
      .mockResolvedValueOnce(openRepoOk)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAlias = () => resolve(openRepoOk)
          })
      )
    let firstSession: RepoSession | undefined
    const firstRender = render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (firstSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    await act(async () => {
      await firstSession?.openRepo(aliasPath)
    })
    vi.mocked(window.electronAPI.closeRepo).mockClear()
    firstRender.unmount()

    let reopenedSession: RepoSession | undefined
    render(
      <QueryProvider client={createQueryClient({ gcTime: Number.POSITIVE_INFINITY })}>
        <GitStoreHarness
          initialTabActive={true}
          onGit={() => {}}
          onSession={(session) => (reopenedSession = session)}
          onSetTabActive={() => {}}
        />
      </QueryProvider>
    )
    let reopen: Promise<string | null> | undefined
    act(() => {
      reopen = reopenedSession?.openRepo(aliasPath)
    })
    await advanceTimers(0)

    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(repoPath, expect.any(Number))

    await act(async () => {
      resolveAlias()
      await reopen
    })
    await advanceTimers(20)

    expect(reopenedSession?.repoPath).toBe(repoPath)
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalledWith(repoPath, expect.any(Number))
  })

  it('local branches paint before log stream completes', async () => {
    vi.mocked(window.electronAPI.startLogStream).mockImplementation(() => new Promise(() => {}))
    sidecarMock.getLocalBranches.mockImplementation(async () => {
      return localBranchesOk
    })

    const { git } = renderGitStore()
    await git.openRepo(repoPath)

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
    await git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
      expect(git.state.branchesLoading).toBe(false)
    })
    expect(git.state.branches?.remotes).toEqual([])

    await act(async () => resolveRemote())
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

    const { git, startGitCall } = renderGitStore()
    await git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.branches?.all).toEqual(['main', 'dev'])
    })

    const refresh = startGitCall((current) =>
      current.runAction('createBranch', () => Promise.resolve({ _tag: 'Ok' as const }), 'Created')
    )

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(git.state.branchesLoading).toBe(false)
    })

    await act(async () => {
      resolveRefetch()
      await refresh
    })
  })

  it('checkout updates the current branch from fresh sidecar reads', async () => {
    const { git } = renderGitStore()
    await git.openRepo(repoPath)

    await waitFor(() => {
      expect(git.state.currentBranch).toBe('main')
    })

    sidecarMock.getStatus.mockResolvedValue(statusResponse({ current: 'dev' }))
    sidecarMock.getLocalBranches.mockResolvedValue(
      localBranchesResponse({ current: 'dev', all: ['main', 'dev'] })
    )

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

    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue(
      localBranchesResponse({ current: 'renamed', all: ['renamed', 'dev'] })
    )

    await git.runAction('renameBranch', () => Promise.resolve({ _tag: 'Ok' as const }), 'Renamed')

    await waitFor(() => {
      expect(git.state.currentBranch).toBe('renamed')
    })
    expect(git.state.status?.current).toBe('main')
  })
})
