import { LOG_PAGE_SIZE } from '@shared/graph-config'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStashes } from '@/hooks/git/useStashes'
import { GitStoreProvider, useRepoSession } from '@/stores/git'
import { renderWithQuery } from '../../../test/render-app'
import { setupLogStream, setupRepoChanged, sidecarMock } from '../../../test/setup'
import {
  type AggregateGit,
  advanceTimers,
  prepareGitStoreMocks,
  renderGitStore,
  repoPath,
  useAggregateGit
} from './git-store-harness'

describe('GitStoreProvider — watcher and streaming', () => {
  beforeEach(() => {
    prepareGitStoreMocks({ pull: true })
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

  it('replays an inactive fetch refresh, including the timeline, when the tab activates', async () => {
    const { git, setTabActive } = renderGitStore(false)
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))
    sidecarMock.getLocalBranches.mockClear()
    vi.mocked(window.electronAPI.startLogStream).mockClear()

    await git.fetchNow()

    expect(sidecarMock.getLocalBranches).not.toHaveBeenCalled()
    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()

    setTabActive(true)

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
      expect(window.electronAPI.startLogStream).toHaveBeenCalled()
    })
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
  it('loadMoreHistory requests the next page without clearing existing commits', async () => {
    const stream = setupLogStream()
    const { git } = renderGitStore()

    await git.openRepo(repoPath)

    act(() => {
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
    })

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

    act(() => {
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
    })

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

    sidecarMock.getLocalBranches.mockClear()
    await act(async () => repoChanged({ repoPath, kind: 'refs' }))

    await waitFor(() => {
      expect(sidecarMock.getLocalBranches).toHaveBeenCalledWith(repoPath)
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
  it('restarts the log stream and refreshes branches on an external refs change', async () => {
    const repoChanged = setupRepoChanged()
    setupLogStream()
    const { git } = renderGitStore()
    await git.openRepo(repoPath)
    await waitFor(() => expect(git.state.repoPath).toBe(repoPath))

    vi.mocked(window.electronAPI.startLogStream).mockClear()
    sidecarMock.getLocalBranches.mockClear()
    await act(async () => repoChanged.fire({ repoPath, kind: 'refs' }))

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

    act(() => {
      stream.fire({ repoPath, streamId: 1, commits: [makeCommit('c1', 'first')] })
      stream.fireDone(repoPath, false)
    })
    await waitFor(() => {
      expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['first'])
    })

    await git.pullNow()

    act(() => {
      stream.fire({ repoPath, streamId: 1, commits: [makeCommit('stale', 'stale-generation')] })
      stream.fire({ repoPath, streamId: 2, commits: [makeCommit('c2', 'second')] })
      stream.fireDone(repoPath, false)
    })

    await waitFor(() => {
      expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['second'])
    })
  })

  it('publishes a completed log buffer while the tab is inactive', async () => {
    vi.useFakeTimers()
    const stream = setupLogStream()
    const { git, setTabActive } = renderGitStore(true)
    await git.openRepo(repoPath)

    setTabActive(false)
    act(() => {
      stream.fire({ repoPath, commits: [makeCommit('a', 'A'), makeCommit('b', 'B')] })
      stream.fireDone(repoPath, true)
    })
    await advanceTimers(200)

    expect(git.state.log?.all.map((commit) => commit.message)).toEqual(['A', 'B'])

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
    await act(async () => repoChanged.fire({ repoPath, kind: 'workingTree' }))

    await waitFor(() => {
      expect(sidecarMock.stashList.mock.calls.length).toBeGreaterThan(callsAfterOpen)
    })
  })
})
