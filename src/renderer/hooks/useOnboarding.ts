import { useCallback, useEffect, useState } from 'react'

export function useOnboarding() {
  const [onboardingComplete, setOnboardingCompleteState] = useState<boolean | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [activeWorkspace, setActiveWorkspaceState] = useState<string | null>(null)
  const [discoveredRepos, setDiscoveredRepos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scanWorkspace = useCallback(async (path: string | null) => {
    if (!path) {
      setDiscoveredRepos([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.scanForRepos(path)
      if (result.success && result.repos) {
        setDiscoveredRepos(result.repos)
      } else if (!result.success) {
        setDiscoveredRepos([])
        setError(result.error || 'Failed to scan for repositories')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    window.electronAPI.getOnboardingComplete().then((complete) => {
      setOnboardingCompleteState(complete)
    })
    Promise.all([window.electronAPI.getWorkspaces(), window.electronAPI.getActiveWorkspace()]).then(
      ([list, active]) => {
        const safeList = list ?? []
        setWorkspaces(safeList)
        const resolved = active ?? safeList[0] ?? null
        setActiveWorkspaceState(resolved)
        if (resolved) scanWorkspace(resolved)
      }
    )
  }, [scanWorkspace])

  const completeOnboarding = useCallback(async () => {
    await window.electronAPI.setOnboardingComplete(true)
    setOnboardingCompleteState(true)
  }, [])

  const selectWorkingDirectory = useCallback(async () => {
    setError(null)
    const path = await window.electronAPI.selectFolder()
    if (!path) return null
    setLoading(true)
    try {
      const list = await window.electronAPI.addWorkspace(path)
      setWorkspaces(list ?? [path])
      setActiveWorkspaceState(path)
      await scanWorkspace(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
    return path
  }, [scanWorkspace])

  const rescanWorkingDirectory = useCallback(async () => {
    if (!activeWorkspace) return
    await scanWorkspace(activeWorkspace)
  }, [activeWorkspace, scanWorkspace])

  const addWorkspace = useCallback(async () => {
    setError(null)
    const path = await window.electronAPI.selectFolder()
    if (!path) return null
    setLoading(true)
    try {
      const list = await window.electronAPI.addWorkspace(path)
      setWorkspaces(list ?? [path])
      setActiveWorkspaceState(path)
      await scanWorkspace(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
    return path
  }, [scanWorkspace])

  const removeWorkspace = useCallback(
    async (path: string) => {
      setError(null)
      try {
        const list = await window.electronAPI.removeWorkspace(path)
        const safeList = list ?? []
        setWorkspaces(safeList)
        if (activeWorkspace === path) {
          const next = safeList[0] ?? null
          setActiveWorkspaceState(next)
          await window.electronAPI.setActiveWorkspace(next)
          await scanWorkspace(next)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    },
    [activeWorkspace, scanWorkspace]
  )

  const switchWorkspace = useCallback(
    async (path: string) => {
      if (path === activeWorkspace) return
      setError(null)
      setActiveWorkspaceState(path)
      await window.electronAPI.setActiveWorkspace(path)
      await scanWorkspace(path)
    },
    [activeWorkspace, scanWorkspace]
  )

  return {
    onboardingComplete,
    workingDirectory: activeWorkspace,
    workspaces,
    activeWorkspace,
    discoveredRepos,
    loading,
    error,
    completeOnboarding,
    selectWorkingDirectory,
    rescanWorkingDirectory,
    addWorkspace,
    removeWorkspace,
    switchWorkspace
  }
}
