import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGit } from './useGit'

describe('useGit', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should start with no repo loaded', () => {
    const { result } = renderHook(() => useGit())

    expect(result.current.repoPath).toBeNull()
    expect(result.current.status).toBeNull()
    expect(result.current.log).toBeNull()
    expect(result.current.currentBranch).toBe('')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should open a repo successfully', async () => {
    const mockRepoData = {
      success: true,
      path: '/test/repo',
      status: {
        current: 'main',
        modified: ['file1.ts'],
        staged: [],
        not_added: []
      },
      log: {
        all: [
          { hash: 'abc123', message: 'Initial commit', author_name: 'Test', date: '2024-01-01' }
        ],
        total: 1
      },
      branches: { current: 'main', all: ['main'] }
    }

    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(mockRepoData)

    const { result } = renderHook(() => useGit())

    await result.current.openRepo('/test/repo')

    await waitFor(() => {
      expect(result.current.repoPath).toBe('/test/repo')
      expect(result.current.currentBranch).toBe('main')
      expect(result.current.status?.modified).toContain('file1.ts')
    })

    expect(window.electronAPI.openRepo).toHaveBeenCalledWith('/test/repo')
  })

  it('should handle repo open failure', async () => {
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
  })

  it('should stage a file with the active repoPath and refresh status', async () => {
    const mockRepoData = {
      success: true,
      path: '/test/repo',
      status: { current: 'main', modified: [], staged: ['file1.ts'], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    }

    vi.mocked(window.electronAPI.openRepo).mockResolvedValue(mockRepoData)
    vi.mocked(window.electronAPI.stageFile).mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.stageFile('file1.ts')

    expect(window.electronAPI.stageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
  })

  it('should unstage a file with the active repoPath', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/test/repo',
      status: { current: 'main', modified: [], staged: ['file1.ts'], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })
    vi.mocked(window.electronAPI.unstageFile).mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.unstageFile('file1.ts')

    expect(window.electronAPI.unstageFile).toHaveBeenCalledWith('/test/repo', 'file1.ts')
  })

  it('should commit with the active repoPath', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/test/repo',
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })
    vi.mocked(window.electronAPI.commit).mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    const ok = await result.current.commit('my message')

    expect(ok).toBe(true)
    expect(window.electronAPI.commit).toHaveBeenCalledWith('/test/repo', 'my message')
  })

  it('closeRepo evicts the repo on the main side and clears local state', async () => {
    vi.mocked(window.electronAPI.openRepo).mockResolvedValue({
      success: true,
      path: '/test/repo',
      status: { current: 'main', modified: [], staged: [], not_added: [] },
      log: { all: [], total: 0 },
      branches: { current: 'main', all: ['main'] }
    })
    vi.mocked(window.electronAPI.closeRepo).mockResolvedValue({ success: true })

    const { result } = renderHook(() => useGit())
    await result.current.openRepo('/test/repo')
    await waitFor(() => expect(result.current.repoPath).toBe('/test/repo'))

    await result.current.closeRepo()

    expect(window.electronAPI.closeRepo).toHaveBeenCalledWith('/test/repo')
    await waitFor(() => {
      expect(result.current.repoPath).toBeNull()
      expect(result.current.status).toBeNull()
      expect(result.current.currentBranch).toBe('')
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
