import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/app/QueryProvider'
import { useCommitHistory } from '@/features/history/store'
import { useWorkingTreeStatus } from '@/features/status/store'
import { repoQueryKeys } from '@/lib/query-keys'
import { GitStoreProvider } from '@/stores/git'
import { useRepoSession } from '@/stores/repo-session'
import {
  localBranchesResponse,
  openedRepoResponse,
  remoteRefsResponse,
  statusResponse
} from '../../../../test/builders'
import { renderWithQuery } from '../../../../test/render-app'
import {
  type LogStreamHandle,
  setupLogStream,
  setupRepoChanged,
  sidecarMock
} from '../../../../test/setup'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const repoPath = '/home/user/project'

const statusOk = statusResponse({ modified: ['src/app.ts'] })

let diffRenderCount = 0

function DiffProbe() {
  useWorkingTreeStatus()
  useRepoSession()
  diffRenderCount += 1
  return null
}

function HistoryProbe() {
  const history = useCommitHistory()
  const hashes = history.log?.all.map((commit) => commit.hash).join(',') ?? ''
  return (
    <>
      <div data-testid="log-total">
        {history.log?.loadedCount ?? 0}|{history.logHasMore ? 'more' : 'end'}
      </div>
      <div data-testid="log-hashes">{hashes}</div>
    </>
  )
}

function SessionErrorProbe() {
  return <div data-testid="session-error">{useRepoSession().error ?? ''}</div>
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

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  diffRenderCount = 0
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue(openedRepoResponse(repoPath))
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  logStream = setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusOk)
  sidecarMock.getLocalBranches.mockResolvedValue(localBranchesResponse())
  sidecarMock.getRemoteRefs.mockResolvedValue(remoteRefsResponse())
})

describe('useCommitHistory — concern isolation', () => {
  it('retains a mutation error with the same message after history recovers', async () => {
    const repoChanged = setupRepoChanged()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let stageFile: ((file: string) => Promise<unknown>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      stageFile = useWorkingTreeStatus().stageFile
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <OpenController />
        <SessionErrorProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    logStream.fire({ repoPath, commits: [], error: 'operation failed' })
    sidecarMock.stageFile.mockResolvedValueOnce({
      _tag: 'GitError',
      message: 'operation failed'
    })
    await act(async () => {
      await stageFile?.('src/app.ts')
      repoChanged.fire({ repoPath, kind: 'refs' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toHaveTextContent('Git rejected the change')
    })
  })

  it('clears its matching session error after a successful stream restart', async () => {
    const repoChanged = setupRepoChanged()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let stageFile: ((file: string) => Promise<unknown>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      stageFile = useWorkingTreeStatus().stageFile
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <OpenController />
        <SessionErrorProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    logStream.fire({ repoPath, commits: [], error: 'history unavailable' })
    expect(screen.getByTestId('session-error')).toHaveTextContent('Could not read history')

    await act(async () => {
      repoChanged.fire({ repoPath, kind: 'refs' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toBeEmptyDOMElement()
    })

    logStream.fire({ repoPath, commits: [], error: 'history unavailable again' })
    sidecarMock.stageFile.mockResolvedValueOnce({ _tag: 'GitError', message: 'cannot stage' })
    await act(async () => {
      await stageFile?.('src/app.ts')
      repoChanged.fire({ repoPath, kind: 'refs' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('session-error')).toHaveTextContent('Git rejected the change')
    })
  })

  it('shows a streamed chunk in history without re-rendering the diff view', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <OpenController />
        <DiffProbe />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('0|end')
    })

    const rendersBeforeStream = diffRenderCount

    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('aaa1111')] })
      logStream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1|end')
    })
    expect(diffRenderCount).toBe(rendersBeforeStream)
  })

  it('starts a replacement stream without a separate cancel round trip', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <OpenController />
      </GitStoreProvider>
    ))
    vi.mocked(window.electronAPI.cancelLogStream).mockClear()

    await act(async () => {
      await openRepo?.(repoPath)
    })

    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)
    expect(window.electronAPI.cancelLogStream).not.toHaveBeenCalled()
  })

  it('does not schedule a log flush after an unrelated render', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let forceRender: (() => void) | undefined
    function OpenController() {
      useCommitHistory()
      openRepo = useRepoSession().openRepo
      return null
    }
    function StoreHarness() {
      const [, setTick] = useState(0)
      forceRender = () => setTick((tick) => tick + 1)
      return (
        <GitStoreProvider tabId="hist-tab" tabActive={true}>
          <OpenController />
        </GitStoreProvider>
      )
    }
    renderWithQuery(() => <StoreHarness />)

    await act(async () => {
      await openRepo?.(repoPath)
      logStream.fire({ repoPath, commits: [streamedCommit('a')] })
      logStream.fireDone(repoPath, false)
      await vi.advanceTimersByTimeAsync(100)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    setTimeoutSpy.mockClear()

    act(() => {
      forceRender?.()
    })

    const logFlushTimers = setTimeoutSpy.mock.calls.filter((call) => call[1] === 100)
    setTimeoutSpy.mockRestore()
    vi.useRealTimers()
    expect(logFlushTimers).toHaveLength(0)
  })

  it('does not mutate a published cache snapshot while the next chunk is buffered', async () => {
    vi.useFakeTimers()
    const queryClient = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(
      () => (
        <GitStoreProvider tabId="hist-tab" tabActive={true}>
          <OpenController />
        </GitStoreProvider>
      ),
      queryClient
    )

    await act(async () => {
      await openRepo?.(repoPath)
      logStream.fire({ repoPath, commits: [streamedCommit('first')] })
      logStream.fireDone(repoPath, false)
    })
    const firstSnapshot = queryClient.getQueryData<{ all: Array<{ hash: string }> }>(
      repoQueryKeys(repoPath).log
    )
    expect(firstSnapshot?.all.map((commit) => commit.hash)).toEqual(['first'])

    logStream.fire({ repoPath, commits: [streamedCommit('second')] })

    expect(firstSnapshot?.all.map((commit) => commit.hash)).toEqual(['first'])
    expect(queryClient.getQueryData(repoQueryKeys(repoPath).log)).toBe(firstSnapshot)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(
      queryClient
        .getQueryData<{ all: Array<{ hash: string }> }>(repoQueryKeys(repoPath).log)
        ?.all.map((commit) => commit.hash)
    ).toEqual(['first', 'second'])
    expect(firstSnapshot?.all.map((commit) => commit.hash)).toEqual(['first'])
  })

  it('loads the next page through the context without clearing existing commits', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let loadMore: (() => Promise<void>) | undefined
    function HistoryController() {
      const history = useCommitHistory()
      loadMore = history.loadMoreHistory
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <HistoryController />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('page1')] })
      logStream.fireDone(repoPath, true)
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1|more')
    })

    vi.mocked(window.electronAPI.startLogStream).mockClear()
    await act(async () => {
      await loadMore?.()
    })

    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 1,
      maxCount: LOG_PAGE_SIZE,
      streamId: expect.any(Number)
    })

    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('page2')] })
      logStream.fireDone(repoPath, false)
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('2|end')
    })
  })

  it('deduplicates commits when appended pages overlap', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let loadMore: (() => Promise<void>) | undefined
    function HistoryController() {
      const history = useCommitHistory()
      loadMore = history.loadMoreHistory
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <HistoryController />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
      logStream.fire({ repoPath, commits: [streamedCommit('page1')] })
      logStream.fireDone(repoPath, true)
    })
    await act(async () => {
      await loadMore?.()
      logStream.fire({
        repoPath,
        commits: [streamedCommit('page1'), streamedCommit('page2')]
      })
      logStream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('2|end')
    })
    expect(screen.getByTestId('log-hashes')).toHaveTextContent('page1,page2')
  })

  it('replaces a warm cached log when a same-length stream contains different commits', async () => {
    const queryClient = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
    queryClient.setQueryData(repoQueryKeys(repoPath).log, {
      all: [streamedCommit('old-head')],
      loadedCount: 1
    })
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(
      () => (
        <GitStoreProvider tabId="hist-tab" tabActive={true}>
          <OpenController />
          <HistoryProbe />
        </GitStoreProvider>
      ),
      queryClient
    )

    await act(async () => {
      await openRepo?.(repoPath)
    })
    expect(screen.getByTestId('log-hashes')).toHaveTextContent('old-head')

    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('amended-head')] })
      logStream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('log-hashes')).toHaveTextContent('amended-head')
    })
    expect(screen.getByTestId('log-hashes')).not.toHaveTextContent('old-head')
  })

  it('preserves loaded commits and reloads at least their count when refs move', async () => {
    const queryClient = createQueryClient({ gcTime: Number.POSITIVE_INFINITY })
    const cachedCommits = Array.from({ length: LOG_PAGE_SIZE + 1 }, (_unused, index) =>
      streamedCommit(`cached-${index}`)
    )
    queryClient.setQueryData(repoQueryKeys(repoPath).log, {
      all: cachedCommits,
      loadedCount: cachedCommits.length
    })
    const repoChanged = setupRepoChanged()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(
      () => (
        <GitStoreProvider tabId="hist-tab" tabActive={true}>
          <OpenController />
          <HistoryProbe />
        </GitStoreProvider>
      ),
      queryClient
    )

    await act(async () => {
      await openRepo?.(repoPath)
    })
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    await act(async () => {
      repoChanged.fire({ repoPath, kind: 'refs' })
    })

    expect(screen.getByTestId('log-total')).toHaveTextContent(`${cachedCommits.length}|end`)
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith(repoPath, {
      skip: 0,
      maxCount: cachedCommits.length,
      streamId: expect.any(Number)
    })
  })

  it('drops a chunk from a superseded stream after an external refs restart', async () => {
    const repoChanged = setupRepoChanged()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="hist-tab" tabActive={true}>
        <OpenController />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await act(async () => {
      logStream.fire({ repoPath, streamId: 1, commits: [streamedCommit('c1')] })
      logStream.fireDone(repoPath, false)
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1|end')
    })

    await act(async () => {
      repoChanged.fire({ repoPath, kind: 'refs' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1|end')
      expect(screen.getByTestId('log-hashes')).toHaveTextContent('c1')
    })

    await act(async () => {
      logStream.fire({ repoPath, streamId: 1, commits: [streamedCommit('stale')] })
      logStream.fire({ repoPath, streamId: 2, commits: [streamedCommit('c2')] })
      logStream.fireDone(repoPath, false)
    })
    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1|end')
      expect(screen.getByTestId('log-hashes')).toHaveTextContent('c2')
      expect(screen.getByTestId('log-hashes')).not.toHaveTextContent('stale')
    })
  })
})
