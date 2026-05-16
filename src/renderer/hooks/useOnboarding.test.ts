import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useOnboarding } from '@/hooks/useOnboarding'

describe('useOnboarding', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('should start with null onboardingComplete and null workingDirectory', () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)

    const { result } = renderHook(() => useOnboarding())

    expect(result.current.onboardingComplete).toBeNull()
    expect(result.current.workingDirectory).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.discoveredRepos).toEqual([])
  })

  it('should load onboarding state on mount', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue('/home/user/repos')
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      success: true,
      repos: ['/home/user/repos/app']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(false)
      expect(result.current.workingDirectory).toBe('/home/user/repos')
      expect(result.current.discoveredRepos).toEqual(['/home/user/repos/app'])
    })
  })

  it('should select a working directory and scan for repos', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/home/user/projects')
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      success: true,
      repos: ['/home/user/projects/app', '/home/user/projects/lib']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(false)
    })

    await result.current.selectWorkingDirectory()

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/home/user/projects')
      expect(result.current.discoveredRepos).toEqual([
        '/home/user/projects/app',
        '/home/user/projects/lib'
      ])
      expect(result.current.loading).toBe(false)
    })

    expect(window.electronAPI.setWorkingDirectory).toHaveBeenCalledWith('/home/user/projects')
    expect(window.electronAPI.scanForRepos).toHaveBeenCalledWith('/home/user/projects')
  })

  it('should handle scan errors', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)
    vi.mocked(window.electronAPI.selectFolder).mockResolvedValue('/bad/path')
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      success: false,
      error: 'Permission denied'
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(false)
    })

    await result.current.selectWorkingDirectory()

    await waitFor(() => {
      expect(result.current.error).toBe('Permission denied')
      expect(result.current.loading).toBe(false)
    })
  })

  it('should complete onboarding', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(false)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)
    vi.mocked(window.electronAPI.setOnboardingComplete).mockResolvedValue(undefined)

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(false)
    })

    await result.current.completeOnboarding()

    await waitFor(() => {
      expect(result.current.onboardingComplete).toBe(true)
    })

    expect(window.electronAPI.setOnboardingComplete).toHaveBeenCalledWith(true)
  })

  it('should rescan the working directory', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue('/home/user/repos')
    vi.mocked(window.electronAPI.scanForRepos).mockResolvedValue({
      success: true,
      repos: ['/home/user/repos/one']
    })

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.workingDirectory).toBe('/home/user/repos')
    })

    await result.current.rescanWorkingDirectory()

    await waitFor(() => {
      expect(result.current.discoveredRepos).toEqual(['/home/user/repos/one'])
      expect(result.current.loading).toBe(false)
    })

    expect(window.electronAPI.scanForRepos).toHaveBeenCalledWith('/home/user/repos')
  })

  it('should not rescan if no working directory is set', async () => {
    vi.mocked(window.electronAPI.getOnboardingComplete).mockResolvedValue(true)
    vi.mocked(window.electronAPI.getWorkingDirectory).mockResolvedValue(null)

    const { result } = renderHook(() => useOnboarding())

    await waitFor(() => {
      expect(result.current.workingDirectory).toBeNull()
    })

    await result.current.rescanWorkingDirectory()

    expect(window.electronAPI.scanForRepos).not.toHaveBeenCalled()
  })
})
