import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkingTreeStatus } from '@/features/status/store'
import { GitStoreProvider, useCommitHistory, useRepoSession } from '@/stores/git'
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

let statusRenderCount = 0

function StatusProbe() {
  const { status } = useWorkingTreeStatus()
  statusRenderCount += 1
  return <div data-testid="status-modified">{status?.modified.join(',') ?? ''}</div>
}

function HistoryProbe() {
  const history = useCommitHistory()
  return <div data-testid="log-total">{history.log?.loadedCount ?? 0}</div>
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
  statusRenderCount = 0
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

describe('useWorkingTreeStatus — concern isolation', () => {
  it('does not re-render a status-only consumer when a commit streams into history', async () => {
    // The status-only consumer and the history consumer are SIBLINGS under the provider, so the
    // history consumer's re-render on a streamed chunk cannot cascade down into the status consumer.
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="wts-tab" tabActive={true}>
        <OpenController />
        <StatusProbe />
        <HistoryProbe />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await waitFor(() => {
      expect(screen.getByTestId('status-modified')).toHaveTextContent('src/app.ts')
    })

    const rendersBeforeStream = statusRenderCount

    await act(async () => {
      logStream.fire({ repoPath, commits: [streamedCommit('aaa1111')] })
      logStream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(screen.getByTestId('log-total')).toHaveTextContent('1')
    })
    expect(statusRenderCount).toBe(rendersBeforeStream)
  })

  it('updates a status consumer when a stage changes the working tree through the context', async () => {
    sidecarMock.getStatus.mockResolvedValueOnce(statusOk).mockResolvedValue({
      _tag: 'Ok',
      status: { ...statusOk.status, modified: [], staged: ['src/app.ts'] }
    })
    sidecarMock.stageFile.mockResolvedValue({ _tag: 'Ok' })

    let stage: ((file: string) => Promise<unknown>) | undefined
    let openRepo: ((path: string) => Promise<string | null>) | undefined
    function StatusConsumer() {
      const workingTree = useWorkingTreeStatus()
      stage = workingTree.stageFile
      return <div data-testid="staged">{workingTree.status?.staged.join(',') ?? ''}</div>
    }
    function OpenController() {
      openRepo = useRepoSession().openRepo
      return null
    }
    renderWithQuery(() => (
      <GitStoreProvider tabId="wts-tab" tabActive={true}>
        <OpenController />
        <StatusConsumer />
      </GitStoreProvider>
    ))

    await act(async () => {
      await openRepo?.(repoPath)
    })
    await act(async () => {
      await stage?.('src/app.ts')
    })

    await waitFor(() => {
      expect(screen.getByTestId('staged')).toHaveTextContent('src/app.ts')
    })
  })
})
