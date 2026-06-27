import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import { type LogStreamHandle, setupLogStream, sidecarMock } from '@/../test/setup'
import {
  type ActionRunner,
  GitStoreProvider,
  useActionRunner,
  useCommitHistory,
  useRepoSession
} from '@/stores/git'
import { useRefs } from '@/stores/refs'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const repoPath = '/home/user/project'
const otherRepoPath = '/home/user/other-project'

const statusOk = {
  _tag: 'Ok' as const,
  status: {
    current: 'main',
    modified: ['src/app.ts'],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    files: []
  }
}

function streamedCommit(hash: string) {
  return {
    hash,
    message: `commit ${hash}`,
    author_name: 'Tester',
    date: '2026-01-01',
    parents: [] as string[],
    refs: ''
  }
}

let logStream: LogStreamHandle

const advanceTimers = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: {
      path: repoPath,
      remotes: { origin: 'git@example.com:me/project.git' },
      defaultBranch: 'main'
    }
  })
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  logStream = setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusOk)
  sidecarMock.getLocalBranches.mockResolvedValue({
    _tag: 'Ok',
    branches: { current: 'main', all: ['main', 'dev'] }
  })
  sidecarMock.getRemoteRefs.mockResolvedValue({
    _tag: 'Ok',
    refs: { remotes: ['origin/main'], tags: ['v1'] }
  })
})

describe('useRefs', () => {
  it('exposes branches, current branch, remotes, and default branch after open', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    function RefsProbe() {
      const refs = useRefs()
      return (
        <>
          <div data-testid="all">{refs.branches?.all.join(',') ?? ''}</div>
          <div data-testid="remote-refs">{refs.branches?.remotes.join(',') ?? ''}</div>
          <div data-testid="tags">{refs.branches?.tags.join(',') ?? ''}</div>
          <div data-testid="current">{refs.currentBranch}</div>
          <div data-testid="remotes">{Object.keys(refs.remotes).join(',')}</div>
          <div data-testid="default">{refs.defaultBranch ?? ''}</div>
        </>
      )
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <OpenController />
        <RefsProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    await waitFor(() => {
      expect(screen.getByTestId('all')).toHaveTextContent('main,dev')
      expect(screen.getByTestId('remote-refs')).toHaveTextContent('origin/main')
      expect(screen.getByTestId('tags')).toHaveTextContent('v1')
      expect(screen.getByTestId('current')).toHaveTextContent('main')
      expect(screen.getByTestId('remotes')).toHaveTextContent('origin')
      expect(screen.getByTestId('default')).toHaveTextContent('main')
    })
  })

  it('reflects a renamed current branch from a branch-only refresh', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let runAction: ActionRunner['runAction'] | undefined
    function Controller() {
      openRepo = useRepoSession().openRepo
      runAction = useActionRunner().runAction
      return null
    }
    function RefsProbe() {
      return <div data-testid="current">{useRefs().currentBranch}</div>
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Controller />
        <RefsProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('main')
    })

    sidecarMock.getStatus.mockResolvedValue(statusOk)
    sidecarMock.getLocalBranches.mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'renamed', all: ['renamed', 'dev'] }
    })
    await act(async () => {
      await runAction?.('renameBranch', () => Promise.resolve({ _tag: 'Ok' as const }), 'Renamed')
    })

    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('renamed')
    })
  })
})

describe('useRefs — concern isolation', () => {
  it('does not re-render a refs-only consumer when a commit streams into history', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let refsRenderCount = 0
    function RefsProbe() {
      const refs = useRefs()
      refsRenderCount += 1
      return <div data-testid="remote-refs">{refs.branches?.remotes.join(',') ?? ''}</div>
    }
    function HistoryProbe() {
      const history = useCommitHistory()
      return <div data-testid="log-total">{history.log?.total ?? 0}</div>
    }
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <OpenController />
        <RefsProbe />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    // Wait for every refs query (local branches AND remote refs) to settle before snapshotting, so
    // a trailing remote-refs render — a legitimate refs change — is not mistaken for stream fallout.
    await waitFor(() => {
      expect(screen.getByTestId('remote-refs')).toHaveTextContent('origin/main')
    })

    const rendersBeforeStream = refsRenderCount

    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('aaa1111')] })
      logStream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1')
    })
    expect(refsRenderCount).toBe(rendersBeforeStream)
  })
})

describe('useRefs — auto-fetch', () => {
  it('auto-fetches and refreshes branches every 5 minutes while the tab is active', async () => {
    vi.useFakeTimers()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <OpenController />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    sidecarMock.fetchRepo.mockClear()
    sidecarMock.getLocalBranches.mockClear()

    await advanceTimers(5 * 60 * 1000)
    expect(sidecarMock.fetchRepo).toHaveBeenCalledWith(repoPath)
    expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)

    sidecarMock.fetchRepo.mockClear()
    await advanceTimers(5 * 60 * 1000)
    expect(sidecarMock.fetchRepo).toHaveBeenCalledWith(repoPath)
  })

  it('does not auto-fetch while the tab is inactive', async () => {
    vi.useFakeTimers()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={false}>
        <OpenController />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    sidecarMock.fetchRepo.mockClear()
    await advanceTimers(5 * 60 * 1000)
    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()
  })

  it('resets the 5-minute auto-fetch interval when a manual fetch runs', async () => {
    vi.useFakeTimers()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let fetchNow: (() => Promise<void>) | undefined
    function Controller() {
      openRepo = useRepoSession().openRepo
      fetchNow = useRefs().fetchNow
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Controller />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    sidecarMock.fetchRepo.mockClear()
    await advanceTimers(4 * 60 * 1000)
    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()

    await act(async () => {
      await fetchNow?.()
    })
    expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(1)
    sidecarMock.fetchRepo.mockClear()

    // Four more minutes — only four since the manual fetch, so the reset interval has not elapsed.
    await advanceTimers(4 * 60 * 1000)
    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()

    // Crossing five minutes since the manual fetch fires the auto-fetch.
    await advanceTimers(60 * 1000)
    expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed auto-fetch as an error rather than an unhandled rejection', async () => {
    vi.useFakeTimers()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function Probe() {
      const session = useRepoSession()
      openRepo = session.openRepo
      return <div data-testid="error">{session.error ?? ''}</div>
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Probe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    sidecarMock.fetchRepo.mockRejectedValue(new Error('network down'))
    await advanceTimers(5 * 60 * 1000)

    expect(screen.getByTestId('error')).toHaveTextContent('network down')
  })
})

describe('useRefs — per-repo fetch timestamp', () => {
  it('scopes the fetched timestamp to the repo it was fetched for', async () => {
    vi.mocked(window.electronAPI.openRepo)
      .mockResolvedValueOnce({
        _tag: 'Ok',
        result: { path: repoPath, remotes: {}, defaultBranch: 'main' }
      })
      .mockResolvedValueOnce({
        _tag: 'Ok',
        result: { path: otherRepoPath, remotes: {}, defaultBranch: 'main' }
      })

    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let fetchNow: (() => Promise<void>) | undefined
    function Probe() {
      const refs = useRefs()
      openRepo = useRepoSession().openRepo
      fetchNow = refs.fetchNow
      return <div data-testid="last-fetch">{refs.lastFetchedAt != null ? 'set' : 'unset'}</div>
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Probe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await act(async () => {
      await fetchNow?.()
    })
    expect(screen.getByTestId('last-fetch')).toHaveTextContent('set')

    await act(async () => {
      await openRepo?.(otherRepoPath)
    })
    await waitFor(() => {
      expect(screen.getByTestId('last-fetch')).toHaveTextContent('unset')
    })
  })
})
