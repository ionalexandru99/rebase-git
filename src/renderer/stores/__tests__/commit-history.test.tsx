import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/../test/render-app'
import {
  type LogStreamHandle,
  setupLogStream,
  setupRepoChanged,
  sidecarMock
} from '@/../test/setup'
import { useCommitHistory } from '@/stores/commit-history'
import { GitStoreProvider, useGitStore } from '@/stores/git'
import { useRepoSession } from '@/stores/repo-session'
import { useWorkingTreeStatus } from '@/stores/working-tree-status'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast }))

const repoPath = '/home/user/project'

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
        {history.log?.total ?? 0}|{history.logHasMore ? 'more' : 'end'}
      </div>
      <div data-testid="log-hashes">{hashes}</div>
    </>
  )
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

beforeEach(() => {
  diffRenderCount = 0
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: { path: repoPath, remotes: {}, defaultBranch: 'main' }
  })
  vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.onRepoChanged).mockReturnValue(() => {})
  logStream = setupLogStream()
  sidecarMock.getStatus.mockResolvedValue(statusOk)
  sidecarMock.getLocalBranches.mockResolvedValue({
    _tag: 'Ok',
    branches: { current: 'main', all: ['main'] }
  })
  sidecarMock.getRemoteRefs.mockResolvedValue({ _tag: 'Ok', refs: { remotes: [], tags: [] } })
})

describe('useCommitHistory — concern isolation', () => {
  it('shows a streamed chunk in history without re-rendering the diff view', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useGitStore().openRepo
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

  it('loads the next page through the context without clearing existing commits', async () => {
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    let loadMore: (() => Promise<void>) | undefined
    function HistoryController() {
      const history = useCommitHistory()
      loadMore = history.loadMoreHistory
      openRepo = useGitStore().openRepo
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

  it('drops a chunk from a superseded stream after an external refs restart', async () => {
    const repoChanged = setupRepoChanged()
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useGitStore().openRepo
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
      expect(screen.getByTestId('log-total')).toHaveTextContent('0|end')
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
