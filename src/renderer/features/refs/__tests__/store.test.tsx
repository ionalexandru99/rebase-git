import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRefs } from '@/features/refs/store'
import {
  type ActionRunner,
  GitStoreProvider,
  useActionRunner,
  useCommitHistory,
  useRepoSession,
  useWorkingTreeStatus
} from '@/stores/git'
import {
  localBranchesResponse,
  openedRepoResponse,
  remoteRefsResponse,
  statusResponse
} from '../../../../test/builders'
import { renderWithQuery } from '../../../../test/render-app'
import { type LogStreamHandle, setupLogStream, sidecarMock } from '../../../../test/setup'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const repoPath = '/home/user/project'
const otherRepoPath = '/home/user/other-project'

const statusOk = statusResponse({ modified: ['src/app.ts'] })

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
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(
    openedRepoResponse(repoPath, { remotes: { origin: 'git@example.com:me/project.git' } })
  )
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  logStream = setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusOk)
  sidecarMock.getLocalBranches.mockResolvedValue(localBranchesResponse({ all: ['main', 'dev'] }))
  sidecarMock.getRemoteRefs.mockResolvedValue(
    remoteRefsResponse({ remotes: ['origin/main'], tags: ['v1'] })
  )
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
    sidecarMock.getLocalBranches.mockResolvedValue(
      localBranchesResponse({ current: 'renamed', all: ['renamed', 'dev'] })
    )
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
      return <div data-testid="log-total">{history.log?.loadedCount ?? 0}</div>
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
  it('leaves the banner to the read paths — a fetch failure only toasts', async () => {
    sidecarMock.getStatus.mockResolvedValueOnce({
      _tag: 'GitError',
      message: 'status unavailable'
    })
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let fetchNow: (() => Promise<void>) | undefined
    function Probe() {
      const refs = useRefs()
      const session = useRepoSession()
      openRepo = session.openRepo
      fetchNow = refs.fetchNow
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
    await waitFor(() => {
      expect(screen.getByTestId('error')).toHaveTextContent('Could not read the working tree')
    })

    sidecarMock.fetchRepo.mockResolvedValueOnce({ _tag: 'GitError', message: 'network down' })
    await act(async () => {
      await fetchNow?.()
    })

    expect(toast.error).toHaveBeenCalledWith('Fetch failed', expect.anything())
    expect(screen.getByTestId('error')).toHaveTextContent('Could not read the working tree')
  })

  it('keeps a mutation error on the banner across later fetches', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let fetchNow: (() => Promise<void>) | undefined
    let stageFile: ((file: string) => Promise<unknown>) | undefined
    function Probe() {
      const refs = useRefs()
      const session = useRepoSession()
      openRepo = session.openRepo
      fetchNow = refs.fetchNow
      stageFile = useWorkingTreeStatus().stageFile
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
    sidecarMock.stageFile.mockResolvedValueOnce({ _tag: 'GitError', message: 'cannot stage' })
    await act(async () => {
      await stageFile?.('src/app.ts')
    })
    expect(screen.getByTestId('error')).toHaveTextContent('Git rejected the change')

    sidecarMock.fetchRepo.mockResolvedValueOnce({ _tag: 'Ok' })
    await act(async () => {
      await fetchNow?.()
    })

    expect(screen.getByTestId('error')).toHaveTextContent('Git rejected the change')
  })

  it('refreshes the timeline after a successful fetch', async () => {
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
    await waitFor(() => {
      expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    })
    await act(async () => {
      logStream.fireDone(repoPath, false)
    })
    const startsBeforeFetch = vi.mocked(window.electronAPI.startLogStream).mock.calls.length

    await act(async () => {
      await fetchNow?.()
    })

    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(startsBeforeFetch + 1)
  })

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

    await advanceTimers(4 * 60 * 1000)
    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()

    await advanceTimers(60 * 1000)
    expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(1)
  })

  it('surfaces a failed auto-fetch as a toast rather than an unhandled rejection', async () => {
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
    toast.error.mockClear()

    sidecarMock.fetchRepo.mockRejectedValue(new Error('network down'))
    await advanceTimers(5 * 60 * 1000)

    expect(toast.error).toHaveBeenCalledWith('Fetch failed', expect.anything())
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  })

  it('does not re-toast a background fetch that keeps failing the same way', async () => {
    vi.useFakeTimers()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function Probe() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Probe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    toast.error.mockClear()

    sidecarMock.fetchRepo.mockResolvedValue({
      _tag: 'GitError',
      message: 'ssh: connect to host example.com port 22: Connection refused'
    })
    await advanceTimers(5 * 60 * 1000)
    await advanceTimers(5 * 60 * 1000)

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(
      'Fetch failed',
      expect.objectContaining({
        description: expect.stringContaining("Couldn't reach example.com")
      })
    )
  })

  it('tells a manual fetch that system auth is unconfigured', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let fetchNow: (() => Promise<void>) | undefined
    function Probe() {
      const session = useRepoSession()
      openRepo = session.openRepo
      fetchNow = useRefs().fetchNow
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

    sidecarMock.fetchRepo.mockResolvedValueOnce({
      _tag: 'GitError',
      message: "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
    })
    await act(async () => {
      await fetchNow?.()
    })

    expect(toast.error).toHaveBeenCalledWith(
      'Fetch failed',
      expect.objectContaining({
        description: expect.stringContaining('credential helper')
      })
    )
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  })

  it('reports a manual fetch that succeeded', async () => {
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
    toast.success.mockClear()

    await act(async () => {
      await fetchNow?.()
    })

    expect(toast.success).toHaveBeenCalledWith('Fetched from remote')
  })
})

describe('useRefs — per-repo fetch timestamp', () => {
  it('scopes the fetched timestamp to the repo it was fetched for', async () => {
    vi.mocked(window.electronAPI.openRepo)
      .mockResolvedValueOnce(openedRepoResponse(repoPath))
      .mockResolvedValueOnce(openedRepoResponse(otherRepoPath))

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

describe('useRefs — branch freshness', () => {
  it('carries each branch tip committer date through to the combined branches', async () => {
    sidecarMock.getLocalBranches.mockResolvedValue(
      localBranchesResponse({
        all: ['main', 'dev'],
        lastCommitAt: { main: '2026-01-02T03:04:05+00:00', dev: '2025-12-31T23:59:59+00:00' }
      })
    )
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function Probe() {
      const refs = useRefs()
      openRepo = useRepoSession().openRepo
      return <div data-testid="freshness">{refs.branches?.lastCommitAt?.main ?? ''}</div>
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Probe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    await waitFor(() => {
      expect(screen.getByTestId('freshness')).toHaveTextContent('2026-01-02T03:04:05+00:00')
    })
  })

  it('carries remote branch and tag freshness through to the combined branches', async () => {
    sidecarMock.getRemoteRefs.mockResolvedValue(
      remoteRefsResponse({
        remotes: ['origin/main'],
        tags: ['v1'],
        remoteLastCommitAt: { 'origin/main': '2026-01-01T00:00:00+00:00' },
        tagLastCommitAt: { v1: '2025-11-11T11:11:11+00:00' }
      })
    )
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function Probe() {
      const refs = useRefs()
      openRepo = useRepoSession().openRepo
      return (
        <div>
          <div data-testid="remote-freshness">
            {refs.branches?.remoteLastCommitAt?.['origin/main'] ?? ''}
          </div>
          <div data-testid="tag-freshness">{refs.branches?.tagLastCommitAt?.v1 ?? ''}</div>
        </div>
      )
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="refs-tab" tabActive={true}>
        <Probe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })

    await waitFor(() => {
      expect(screen.getByTestId('remote-freshness')).toHaveTextContent('2026-01-01T00:00:00+00:00')
    })
    expect(screen.getByTestId('tag-freshness')).toHaveTextContent('2025-11-11T11:11:11+00:00')
  })
})
