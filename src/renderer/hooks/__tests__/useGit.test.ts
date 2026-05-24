import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupLogStream, setupRepoChanged, sidecarMock } from '@/../test/setup'
import type { GitStatus } from '@/types'
import { useGit } from '../useGit'

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    current: 'main',
    modified: [],
    staged: [],
    not_added: [],
    conflicted: [],
    deleted: [],
    created: [],
    renamed: [],
    ...overrides
  }
}

function mockOpenRepoSuccess(s: GitStatus = status(), path = '/test/repo') {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    _tag: 'Ok',
    result: { path, remotes: {}, defaultBranch: s.current }
  })
  vi.mocked(sidecarMock.getStatus).mockResolvedValue({
    _tag: 'Ok',
    status: s
  })
  vi.mocked(sidecarMock.getBranches).mockResolvedValue({
    _tag: 'Ok',
    branches: { current: s.current, all: [s.current], remotes: [], tags: [] }
  })
}

describe('useGit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupLogStream()
  })

  it('should start with no repo loaded', () => {
    const { result } = renderHook(() => useGit())

    expect(result.current.repoPath).toBeNull()
    expect(result.current.status).toBeNull()
    expect(result.current.log).toBeNull()
    expect(result.current.currentBranch).toBe('')
    expect(result.current.loading).toBe(false)
    expect(result.current.logLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('loads status and branches concurrently with the log stream IPC', async () => {
    mockOpenRepoSuccess()

    let resolveStartLogStream: (response: { _tag: 'Ok' }) => void = () => {}
    vi.mocked(window.electronAPI.startLogStream).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStartLogStream = resolve
        })
    )

    const { result } = renderHook(() => useGit())
    const openPromise = result.current.openRepo('/test/repo')

    await waitFor(() => {
      expect(sidecarMock.getStatus).toHaveBeenCalledWith('/test/repo')
      expect(sidecarMock.getBranches).toHaveBeenCalledWith('/test/repo')
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/test/repo')

    resolveStartLogStream({ _tag: 'Ok' })
    await openPromise
  })

  it('opens a repo and streams commits in chunks', async () => {
    mockOpenRepoSuccess(status({ modified: ['file1.ts'] }))
    const stream = setupLogStream()

    const { result } = renderHook(() => useGit())

    await result.current.openRepo('/test/repo')

    await waitFor(() => {
      expect(result.current.repoPath).toBe('/test/repo')
      expect(result.current.currentBranch).toBe('main')
      expect(result.current.status?.modified).toContain('file1.ts')
    })
    expect(window.electronAPI.startLogStream).toHaveBeenCalledWith('/test/repo')

    await waitFor(() => expect(result.current.logLoading).toBe(true))

    stream.fire({
      repoPath: '/test/repo',
      commits: [
        {
          hash: 'abc123',
          message: 'first',
          author_name: 'A',
          date: '2024-01-01',
          parents: [],
          refs: ''
        }
      ]
    })
    await waitFor(() => expect(result.current.log?.total).toBe(1))

    stream.fire({
      repoPath: '/test/repo',
      commits: [
        {
          hash: 'def456',
          message: 'second',
          author_name: 'B',
          date: '2024-01-02',
          parents: ['abc123'],
          refs: ''
        }
      ]
    })
    await waitFor(() => expect(result.current.log?.total).toBe(2))

    stream.fireDone('/test/repo')
    await waitFor(() => expect(result.current.logLoading).toBe(false))
    expect(result.current.log?.all.map((c) => c.hash)).toEqual(['abc123', 'def456'])
  })

  it('ignores chunks that arrive for an inactive repo path', async () => {
    mockOpenRepoSuccess(status())
    const stream = setupLogStream()

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    stream.fire({
      repoPath: '/some/other/repo',
      commits: [
        {
          hash: 'stray',
          message: 'm',
          author_name: 'X',
          date: 'd',
          parents: [],
          refs: ''
        }
      ]
    })

    expect(result.current.log?.total ?? 0).toBe(0)
  })

  it('should handle repo open failure and not start a stream', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'NotARepo'
    })

    const { result } = renderHook(() => useGit())

    await result.current.openRepo('/bad/path')

    await waitFor(() => {
      expect(result.current.error).toBe('Not a git repository')
      expect(result.current.repoPath).toBeNull()
    })

    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('clears the provisional path on open failure so stale events are ignored', async () => {
    const repoChanged = setupRepoChanged()
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({ _tag: 'NotARepo' })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/bad/path')
    await waitFor(() => expect(result.current.error).toBe('Not a git repository'))

    vi.mocked(sidecarMock.getBranches).mockClear()
    vi.mocked(sidecarMock.getLog).mockClear()
    vi.mocked(sidecarMock.getStatus).mockClear()
    act(() => repoChanged.fire({ repoPath: '/bad/path', kind: 'refs' }))
    act(() => repoChanged.fire({ repoPath: '/bad/path', kind: 'workingTree' }))

    expect(sidecarMock.getBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getLog).not.toHaveBeenCalled()
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })

  it('stages a file and refreshes status only (no log re-stream)', async () => {
    mockOpenRepoSuccess(status({ modified: ['file1.ts'] }))
    vi.mocked(sidecarMock.stageFile).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status({ staged: ['file1.ts'] })
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)

    await result.current.stageFile('file1.ts')

    expect(sidecarMock.stageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(result.current.status?.staged).toContain('file1.ts'))
  })

  it('unstages a file and refreshes status only', async () => {
    mockOpenRepoSuccess(status({ staged: ['file1.ts'] }))
    vi.mocked(sidecarMock.unstageFile).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status({ modified: ['file1.ts'] })
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.unstageFile('file1.ts')

    expect(sidecarMock.unstageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)
  })

  it('commits and re-streams the log', async () => {
    mockOpenRepoSuccess(status({ staged: ['a.ts'] }))
    vi.mocked(sidecarMock.commit).mockResolvedValue({
      _tag: 'Ok',
      result: {
        commit: 'abc',
        branch: 'main',
        summary: { changes: 0, insertions: 0, deletions: 0 }
      }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status()
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    const streamCallsBeforeCommit = vi.mocked(window.electronAPI.startLogStream).mock.calls.length

    const ok = await result.current.commit('my message')

    expect(ok).toBe(true)
    expect(sidecarMock.commit).toHaveBeenCalledWith('/test/repo', 'my message')
    expect(sidecarMock.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(vi.mocked(window.electronAPI.startLogStream).mock.calls.length).toBeGreaterThan(
      streamCallsBeforeCommit
    )
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
  })

  it('closeRepo evicts the repo on the main side, cancels the stream, and clears state', async () => {
    mockOpenRepoSuccess()
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.closeRepo()

    expect(window.electronAPI.cancelLogStream).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith('/test/repo')
    await waitFor(() => {
      expect(result.current.repoPath).toBeNull()
      expect(result.current.status).toBeNull()
      expect(result.current.currentBranch).toBe('')
      expect(result.current.logLoading).toBe(false)
    })
  })

  it('does not stage/unstage/commit when no repo is open', async () => {
    const { result } = renderHook(() => useGit())

    await result.current.stageFile('a.ts')
    await result.current.unstageFile('a.ts')
    const committed = await result.current.commit('msg')

    expect(sidecarMock.stageFile).not.toHaveBeenCalled()
    expect(sidecarMock.unstageFile).not.toHaveBeenCalled()
    expect(sidecarMock.commit).not.toHaveBeenCalled()
    expect(committed).toBe(false)
  })

  it('surfaces stageFile IPC rejection into the error banner instead of throwing', async () => {
    mockOpenRepoSuccess()
    vi.mocked(sidecarMock.stageFile).mockRejectedValue(new Error('bridge down'))

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.stageFile('a.ts')
    await waitFor(() => expect(result.current.error).toBe('bridge down'))
  })

  it('surfaces commit IPC rejection into the error banner and returns false', async () => {
    mockOpenRepoSuccess()
    vi.mocked(sidecarMock.commit).mockRejectedValue(new Error('lock file held'))

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    const ok = await result.current.commit('msg')
    expect(ok).toBe(false)
    await waitFor(() => expect(result.current.error).toBe('lock file held'))
    expect(result.current.loading).toBe(false)
  })

  it('releases the main-side repo when the hook unmounts (tab close)', async () => {
    mockOpenRepoSuccess()
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({ success: true })

    const { result, unmount } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    unmount()

    expect(window.electronAPI.cancelLogStream).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith('/test/repo')
  })

  it('adopts the canonical path returned by open-repo, not the caller input', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/test/repo', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status({ modified: ['a.ts'] })
    })
    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    const stream = setupLogStream()

    const { result, unmount } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo/')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    stream.fire({
      repoPath: '/test/repo',
      commits: [
        {
          hash: 'abc',
          message: 'm',
          author_name: 'A',
          date: '2024-01-01',
          parents: [],
          refs: ''
        }
      ]
    })
    await waitFor(() => expect(result.current.log?.total).toBe(1))

    await waitFor(() => expect(result.current.status?.modified).toContain('a.ts'))

    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue(undefined)
    vi.mocked(window.electronAPI.cancelLogStream).mockResolvedValue({ success: true })
    unmount()
    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith('/test/repo')
  })

  it('does nothing on unmount when no repo was ever opened', () => {
    const { unmount } = renderHook(() => useGit())
    unmount()
    expect(window.electronAPI.closeRepo).not.toHaveBeenCalled()
    expect(window.electronAPI.cancelLogStream).not.toHaveBeenCalled()
  })

  it('reopening a cached repo seeds instantly and revalidates without re-streaming the log', async () => {
    mockOpenRepoSuccess(status({ modified: ['file1.ts'] }))
    const stream = setupLogStream()

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    stream.fire({
      repoPath: '/test/repo',
      commits: [{ hash: 'a', message: 'm', author_name: 'A', date: 'd', parents: [], refs: '' }]
    })
    await waitFor(() => expect(result.current.log?.total).toBe(1))
    stream.fireDone('/test/repo')

    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)

    await result.current.closeRepo()
    await waitFor(() => expect(result.current.repoPath).toBeNull())

    vi.mocked(sidecarMock.getLog).mockResolvedValue({
      _tag: 'Ok',
      log: {
        all: [{ hash: 'a', message: 'm', author_name: 'A', date: 'd', parents: [], refs: '' }],
        total: 1
      }
    })

    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    expect(result.current.status?.modified).toContain('file1.ts')
    expect(result.current.logLoading).toBe(false)
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(sidecarMock.getLog).toHaveBeenCalledWith('/test/repo'))
    await waitFor(() => expect(result.current.log?.total).toBe(1))
  })

  it('optimistically stages a file and rolls back when the sidecar rejects', async () => {
    mockOpenRepoSuccess(status({ modified: ['file1.ts'] }))
    setupLogStream()

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.status?.modified).toContain('file1.ts'))

    let rejectStage: (error: Error) => void = () => {}
    vi.mocked(sidecarMock.stageFile).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStage = reject
        })
    )

    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageFile('file1.ts')
    })

    await waitFor(() => expect(result.current.status?.staged).toContain('file1.ts'))
    expect(result.current.status?.modified).not.toContain('file1.ts')

    await act(async () => {
      rejectStage(new Error('lock held'))
      await stagePromise
    })

    await waitFor(() => {
      expect(result.current.status?.modified).toContain('file1.ts')
      expect(result.current.status?.staged).not.toContain('file1.ts')
      expect(result.current.error).toBe('lock held')
    })
  })

  it('surfaces a GitError returned by get-status as an error banner', async () => {
    mockOpenRepoSuccess()
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'GitError',
      message: 'index.lock exists'
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')

    await waitFor(() => expect(result.current.error).toBe('index.lock exists'))
    expect(result.current.status).toBeNull()
  })
})

describe('useGit auto-fetch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupLogStream()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openAndFlush() {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/test/repo', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status()
    })
    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    const stream = setupLogStream()

    const rendered = renderHook(() => useGit())
    await act(async () => {
      await rendered.result.current.openRepo('/test/repo')
    })
    await waitFor(() => expect(rendered.result.current.repoPath).toBe('/test/repo'))
    act(() => stream.fireDone('/test/repo'))
    await waitFor(() => expect(rendered.result.current.logLoading).toBe(false))
    vi.mocked(sidecarMock.getBranches).mockClear()
    vi.mocked(sidecarMock.getStatus).mockClear()
    vi.mocked(sidecarMock.getLog).mockClear()
    return rendered
  }

  it('fires fetchRepo on the interval and silently refreshes branches + log', async () => {
    const { result } = await openAndFlush()

    vi.mocked(sidecarMock.fetchRepo).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main', 'feature'], remotes: ['origin/main'], tags: [] }
    })
    vi.mocked(sidecarMock.getLog).mockResolvedValue({
      _tag: 'Ok',
      log: {
        all: [
          {
            hash: 'new1',
            message: 'after fetch',
            author_name: 'A',
            date: '2024-01-02',
            parents: [],
            refs: ''
          }
        ],
        total: 1
      }
    })

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS)
      await Promise.resolve()
    })

    await waitFor(() => expect(sidecarMock.fetchRepo).toHaveBeenCalledWith('/test/repo'))
    await waitFor(() => {
      expect(sidecarMock.getBranches).toHaveBeenCalledWith('/test/repo')
      expect(sidecarMock.getLog).toHaveBeenCalledWith('/test/repo')
    })

    expect(sidecarMock.getStatus).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(result.current.branches?.all).toContain('feature')
      expect(result.current.log?.total).toBe(1)
    })
    expect(result.current.logLoading).toBe(false)
  })

  it('does not refresh when fetchRepo reports skipped', async () => {
    await openAndFlush()
    vi.mocked(sidecarMock.fetchRepo).mockResolvedValue({ _tag: 'FetchSkipped' })

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS)
      await Promise.resolve()
    })

    await waitFor(() => expect(sidecarMock.fetchRepo).toHaveBeenCalledWith('/test/repo'))
    expect(sidecarMock.getBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getLog).not.toHaveBeenCalled()
  })

  it('swallows fetchRepo failures without setting error state', async () => {
    const { result } = await openAndFlush()
    vi.mocked(sidecarMock.fetchRepo).mockResolvedValue({
      _tag: 'GitError',
      message: 'offline'
    })

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS)
      await Promise.resolve()
    })

    await waitFor(() => expect(sidecarMock.fetchRepo).toHaveBeenCalledWith('/test/repo'))
    expect(sidecarMock.getBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getLog).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it('fetchNow runs the fetch immediately and resets the auto-fetch timer', async () => {
    const { result } = await openAndFlush()

    vi.mocked(sidecarMock.fetchRepo).mockResolvedValue({ _tag: 'Ok' })
    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main', 'feature'], remotes: [], tags: [] }
    })
    vi.mocked(sidecarMock.getLog).mockResolvedValue({
      _tag: 'Ok',
      log: { all: [], total: 0 }
    })

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS - 1000)
    })
    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.fetchNow()
    })
    expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(sidecarMock.getBranches).toHaveBeenCalledWith('/test/repo'))

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS - 1000)
    })
    expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
    })
    await waitFor(() => expect(sidecarMock.fetchRepo).toHaveBeenCalledTimes(2))
  })

  it('clears the interval when the hook unmounts', async () => {
    const { unmount } = await openAndFlush()
    vi.mocked(sidecarMock.fetchRepo).mockResolvedValue({ _tag: 'Ok' })
    unmount()

    await act(async () => {
      vi.advanceTimersByTime(AUTO_FETCH_INTERVAL_MS * 3)
      await Promise.resolve()
    })

    expect(sidecarMock.fetchRepo).not.toHaveBeenCalled()
  })
})

describe('useGit repo-changed watcher', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setupLogStream()
  })

  async function openRepoForWatcher(repoChanged = setupRepoChanged()) {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      _tag: 'Ok',
      result: { path: '/test/repo', remotes: {}, defaultBranch: 'main' }
    })
    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status()
    })
    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'main', all: ['main'], remotes: [], tags: [] }
    })
    const stream = setupLogStream()

    const rendered = renderHook(() => useGit())
    await act(async () => {
      await rendered.result.current.openRepo('/test/repo')
    })
    await waitFor(() => expect(rendered.result.current.repoPath).toBe('/test/repo'))
    act(() => stream.fireDone('/test/repo'))
    await waitFor(() => expect(rendered.result.current.logLoading).toBe(false))
    vi.mocked(sidecarMock.getBranches).mockClear()
    vi.mocked(sidecarMock.getStatus).mockClear()
    vi.mocked(sidecarMock.getLog).mockClear()
    return { rendered, repoChanged }
  }

  it('refreshes branches + log on a refs event, updating currentBranch', async () => {
    const { rendered, repoChanged } = await openRepoForWatcher()

    vi.mocked(sidecarMock.getBranches).mockResolvedValue({
      _tag: 'Ok',
      branches: { current: 'feature', all: ['main', 'feature'], remotes: [], tags: [] }
    })
    vi.mocked(sidecarMock.getLog).mockResolvedValue({
      _tag: 'Ok',
      log: {
        all: [
          {
            hash: 'h1',
            message: 'on feature',
            author_name: 'A',
            date: '2024-01-02',
            parents: [],
            refs: ''
          }
        ],
        total: 1
      }
    })

    act(() => repoChanged.fire({ repoPath: '/test/repo', kind: 'refs' }))

    await waitFor(() => {
      expect(sidecarMock.getBranches).toHaveBeenCalledWith('/test/repo')
      expect(sidecarMock.getLog).toHaveBeenCalledWith('/test/repo')
    })
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(rendered.result.current.currentBranch).toBe('feature')
      expect(rendered.result.current.branches?.all).toContain('feature')
      expect(rendered.result.current.log?.total).toBe(1)
    })
    expect(rendered.result.current.logLoading).toBe(false)
  })

  it('refreshes status only on a workingTree event', async () => {
    const { rendered, repoChanged } = await openRepoForWatcher()

    vi.mocked(sidecarMock.getStatus).mockResolvedValue({
      _tag: 'Ok',
      status: status({ modified: ['changed.ts'] })
    })

    act(() => repoChanged.fire({ repoPath: '/test/repo', kind: 'workingTree' }))

    await waitFor(() => expect(sidecarMock.getStatus).toHaveBeenCalledWith('/test/repo'))
    expect(sidecarMock.getBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getLog).not.toHaveBeenCalled()
    await waitFor(() => expect(rendered.result.current.status?.modified).toContain('changed.ts'))
  })

  it('ignores events for an inactive repo path', async () => {
    const { repoChanged } = await openRepoForWatcher()

    act(() => repoChanged.fire({ repoPath: '/some/other/repo', kind: 'refs' }))
    act(() => repoChanged.fire({ repoPath: '/some/other/repo', kind: 'workingTree' }))

    expect(sidecarMock.getBranches).not.toHaveBeenCalled()
    expect(sidecarMock.getLog).not.toHaveBeenCalled()
    expect(sidecarMock.getStatus).not.toHaveBeenCalled()
  })
})
