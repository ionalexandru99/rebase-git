import { renderHook, waitFor } from '@solidjs/testing-library'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboarding } from '../useOnboarding'

function defaultMocks(active: string | null = null, workspaces: string[] = []) {
  vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
  vi.mocked(window.electronAPI.getWorkspaces).mockResolvedValue(workspaces)
  vi.mocked(window.electronAPI.getActiveWorkspace).mockResolvedValue(active)
  vi.mocked(window.electronAPI.addWorkspace).mockImplementation(async (p) => [...workspaces, p])
  vi.mocked(window.electronAPI.removeWorkspace).mockImplementation(async (p) =>
    workspaces.filter((w) => w !== p)
  )
  vi.mocked(window.electronAPI.setActiveWorkspace).mockResolvedValue(undefined)
  vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({ _tag: 'Ok', repos: [] })
}

describe('useOnboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    defaultMocks()
  })

  it('should start with null onboardingComplete and no workspaces', () => {
    const { result } = renderHook(() => useOnboarding())

    expect(result.onboardingComplete()).toBeNull()
    expect(result.workingDirectory()).toBeNull()
    expect(result.workspaces()).toEqual([])
    expect(result.activeWorkspace()).toBeNull()
    expect(result.loading()).toBe(false)
    expect(result.error()).toBeNull()
    expect(result.discoveredRepos()).toEqual([])
  })

  it('should load workspaces and the active workspace on mount', async () => {
    defaultMocks('/home/user/repos', ['/home/user/repos'])
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/repos/app']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.onboardingComplete()).toBe(false)
      expect(result.workingDirectory()).toBe('/home/user/repos')
      expect(result.activeWorkspace()).toBe('/home/user/repos')
      expect(result.workspaces()).toEqual(['/home/user/repos'])
      expect(result.discoveredRepos()).toEqual(['/home/user/repos/app'])
    })
  })

  it('should add the first workspace and scan for repos', async () => {
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/home/user/projects')
    vi.mocked(window.electronAPI.addWorkspace).mockResolvedValue(['/home/user/projects'])
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/projects/app', '/home/user/projects/lib']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.onboardingComplete()).toBe(false)
    })

    await result.addWorkspace()

    await waitFor(() => {
      expect(result.workingDirectory()).toBe('/home/user/projects')
      expect(result.workspaces()).toEqual(['/home/user/projects'])
      expect(result.discoveredRepos()).toEqual([
        '/home/user/projects/app',
        '/home/user/projects/lib'
      ])
      expect(result.loading()).toBe(false)
    })

    expect(window.electronAPI.addWorkspace).toHaveBeenCalledWith('/home/user/projects')
    expect(window.electronAPI.scanForRepos).toHaveBeenCalledWith('/home/user/projects')
  })

  it('should handle scan errors', async () => {
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/bad/path')
    vi.mocked(window.electronAPI.addWorkspace).mockResolvedValue(['/bad/path'])
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'GitError',
      message: 'Permission denied'
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.onboardingComplete()).toBe(false)
    })

    await result.addWorkspace()

    await waitFor(() => {
      expect(result.error()).toBe('Permission denied')
      expect(result.loading()).toBe(false)
    })
  })

  it('should complete onboarding', async () => {
    vi.mocked(window.electronAPI.setOnboardingComplete).mockResolvedValue(undefined)

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.onboardingComplete()).toBe(false)
    })

    await result.completeOnboarding()

    await waitFor(() => {
      expect(result.onboardingComplete()).toBe(true)
    })

    expect(window.electronAPI.setOnboardingComplete).toHaveBeenCalledWith(true)
  })

  it('should rescan the working directory', async () => {
    defaultMocks('/home/user/repos', ['/home/user/repos'])
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/repos/one']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.workingDirectory()).toBe('/home/user/repos')
    })

    await result.rescanWorkingDirectory()

    await waitFor(() => {
      expect(result.discoveredRepos()).toEqual(['/home/user/repos/one'])
      expect(result.loading()).toBe(false)
    })

    expect(window.electronAPI.scanForRepos).toHaveBeenCalledWith('/home/user/repos')
  })

  it('should not rescan if no working directory is set', async () => {
    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.workingDirectory()).toBeNull()
    })

    vi.mocked(window.electronAPI.scanForRepos).mockClear()

    await result.rescanWorkingDirectory()

    expect(window.electronAPI.scanForRepos).not.toHaveBeenCalled()
  })

  it('should add a new workspace and switch to it', async () => {
    defaultMocks('/home/user/personal', ['/home/user/personal'])
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/home/user/work')
    vi.mocked(window.electronAPI.addWorkspace).mockResolvedValue([
      '/home/user/personal',
      '/home/user/work'
    ])
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/work/repo-a']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.activeWorkspace()).toBe('/home/user/personal')
    })

    await result.addWorkspace()

    await waitFor(() => {
      expect(result.workspaces()).toEqual(['/home/user/personal', '/home/user/work'])
      expect(result.activeWorkspace()).toBe('/home/user/work')
      expect(result.discoveredRepos()).toEqual(['/home/user/work/repo-a'])
    })

    expect(window.electronAPI.addWorkspace).toHaveBeenCalledWith('/home/user/work')
  })

  it('should switch to an existing workspace and re-scan', async () => {
    defaultMocks('/home/user/personal', ['/home/user/personal', '/home/user/work'])
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValueOnce({
      _tag: 'Ok',
      repos: ['/home/user/personal/app']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.activeWorkspace()).toBe('/home/user/personal')
    })

    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/work/job']
    })

    await result.switchWorkspace('/home/user/work')

    await waitFor(() => {
      expect(result.activeWorkspace()).toBe('/home/user/work')
      expect(result.discoveredRepos()).toEqual(['/home/user/work/job'])
    })

    expect(window.electronAPI.setActiveWorkspace).toHaveBeenCalledWith('/home/user/work')
    expect(window.electronAPI.scanForRepos).toHaveBeenLastCalledWith('/home/user/work')
  })

  it('should remove a workspace and fall back to the first remaining one', async () => {
    defaultMocks('/home/user/personal', ['/home/user/personal', '/home/user/work'])
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.removeWorkspace).mockResolvedValue(['/home/user/work'])
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      _tag: 'Ok',
      repos: ['/home/user/work/job']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.activeWorkspace()).toBe('/home/user/personal')
    })

    await result.removeWorkspace('/home/user/personal')

    await waitFor(() => {
      expect(result.workspaces()).toEqual(['/home/user/work'])
      expect(result.activeWorkspace()).toBe('/home/user/work')
      expect(result.discoveredRepos()).toEqual(['/home/user/work/job'])
    })

    expect(window.electronAPI.removeWorkspace).toHaveBeenCalledWith('/home/user/personal')
  })
})
