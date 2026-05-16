import { useCallback, useEffect, useState } from 'react'

export function useOnboarding() {
  const [onboardingComplete, setOnboardingCompleteState] = useState<boolean | null>(null)
  const [workingDirectory, setWorkingDirectoryState] = useState<string | null>(null)
  const [discoveredRepos, setDiscoveredRepos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getOnboardingComplete().then((complete) => {
      setOnboardingCompleteState(complete)
    })
    window.electronAPI.getWorkingDirectory().then((dir) => {
      setWorkingDirectoryState(dir)
      if (dir) {
        window.electronAPI.scanForRepos(dir).then((result) => {
          if (result.success && result.repos) {
            setDiscoveredRepos(result.repos)
          }
        })
      }
    })
  }, [])

  const completeOnboarding = useCallback(async () => {
    await window.electronAPI.setOnboardingComplete(true)
    setOnboardingCompleteState(true)
  }, [])

  const selectWorkingDirectory = useCallback(async () => {
    setError(null)
    const path = await window.electronAPI.selectFolder()
    if (path) {
      setLoading(true)
      try {
        await window.electronAPI.setWorkingDirectory(path)
        setWorkingDirectoryState(path)
        const result = await window.electronAPI.scanForRepos(path)
        if (result.success && result.repos) {
          setDiscoveredRepos(result.repos)
        } else if (!result.success) {
          setError(result.error || 'Failed to scan for repositories')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    return path
  }, [])

  const rescanWorkingDirectory = useCallback(async () => {
    if (!workingDirectory) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.scanForRepos(workingDirectory)
      if (result.success && result.repos) {
        setDiscoveredRepos(result.repos)
      } else if (!result.success) {
        setError(result.error || 'Failed to scan for repositories')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [workingDirectory])

  return {
    onboardingComplete,
    workingDirectory,
    discoveredRepos,
    loading,
    error,
    completeOnboarding,
    selectWorkingDirectory,
    rescanWorkingDirectory
  }
}
