import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupLogStream } from '@/../test/setup'
import { useGit } from './useGit'

function mockOpenRepoSuccess(
  status: { current: string; modified: string[]; staged: string[]; not_added: string[] } = {
    current: 'main',
    modified: [],
    staged: [],
    not_added: []
  },
  path = '/test/repo'
) {
  vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
    success: true,
    path,
    remotes: {},
    defaultBranch: status.current
  })
  vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
    success: true,
    status
  })
  vi.mocked(window.electronAPI.getBranches).mockResolvedValue({
    success: true,
    branches: { current: status.current, all: [status.current], remotes: [], tags: [] }
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

  it('opens a repo and streams commits in chunks', async () => {
    mockOpenRepoSuccess({ current: 'main', modified: ['file1.ts'], staged: [], not_added: [] })
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
    mockOpenRepoSuccess({ current: 'main', modified: [], staged: [], not_added: [] })
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
      success: false,
      error: 'Not a git repository'
    })

    const { result } = renderHook(() => useGit())

    await result.current.openRepo('/bad/path')

    await waitFor(() => {
      expect(result.current.error).toBe('Not a git repository')
      expect(result.current.repoPath).toBeNull()
    })

    expect(window.electronAPI.startLogStream).not.toHaveBeenCalled()
  })

  it('stages a file and refreshes status only (no log re-stream)', async () => {
    mockOpenRepoSuccess({ current: 'main', modified: ['file1.ts'], staged: [], not_added: [] })
    vi.mocked(window.electronAPI.stageFile).mockResolvedValue({ success: true })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      success: true,
      status: { current: 'main', modified: [], staged: ['file1.ts'], not_added: [] }
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)

    await result.current.stageFile('file1.ts')

    expect(window.electronAPI.stageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
    expect(window.electronAPI.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(result.current.status?.staged).toContain('file1.ts'))
  })

  it('unstages a file and refreshes status only', async () => {
    mockOpenRepoSuccess({ current: 'main', modified: [], staged: ['file1.ts'], not_added: [] })
    vi.mocked(window.electronAPI.unstageFile).mockResolvedValue({ success: true })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      success: true,
      status: { current: 'main', modified: ['file1.ts'], staged: [], not_added: [] }
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.unstageFile('file1.ts')

    expect(window.electronAPI.unstageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
    expect(window.electronAPI.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(window.electronAPI.startLogStream).toHaveBeenCalledTimes(1)
  })

  it('commits and re-streams the log', async () => {
    mockOpenRepoSuccess({ current: 'main', modified: [], staged: ['a.ts'], not_added: [] })
    vi.mocked(window.electronAPI.commit).mockResolvedValue({ success: true })
    vi.mocked(window.electronAPI.getStatus).mockResolvedValue({
      success: true,
      status: { current: 'main', modified: [], staged: [], not_added: [] }
    })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    const streamCallsBeforeCommit = vi.mocked(window.electronAPI.startLogStream).mock.calls.length

    const ok = await result.current.commit('my message')

    expect(ok).toBe(true)
    expect(window.electronAPI.commit).toHaveBeenCalledWith('/test/repo', 'my message')
    expect(window.electronAPI.getStatus).toHaveBeenCalledWith('/test/repo')
    expect(vi.mocked(window.electronAPI.startLogStream).mock.calls.length).toBeGreaterThan(
      streamCallsBeforeCommit
    )
    expect(window.electronAPI.openRepo).toHaveBeenCalledTimes(1)
  })

  it('closeRepo evicts the repo on the main side, cancels the stream, and clears state', async () => {
    mockOpenRepoSuccess()
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.closeRepo()

    expect(window.electronAPI.cancelLogStream).toHaveBeenCalled()
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

    expect(window.electronAPI.stageFile).not.toHaveBeenCalled()
    expect(window.electronAPI.unstageFile).not.toHaveBeenCalled()
    expect(window.electronAPI.commit).not.toHaveBeenCalled()
    expect(committed).toBe(false)
  })
})
