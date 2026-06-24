import { useCallback, useEffect, useRef, useState } from 'react'
import { rpcScanForRepos } from '@/lib/rpc-client'

export interface OnboardingStore {
  onboardingComplete: boolean | null
  workingDirectory: string | null
  workspaces: string[]
  activeWorkspace: string | null
  discoveredRepos: string[]
  loading: boolean
  error: string | null
  completeOnboarding: () => Promise<void>
  rescanWorkingDirectory: () => Promise<void>
  addWorkspace: () => Promise<string | null>
  removeWorkspace: (path: string) => Promise<void>
  switchWorkspace: (path: string) => Promise<void>
}

export function useOnboarding(): OnboardingStore {
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
  const [discoveredRepos, setDiscoveredRepos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scanGeneration = useRef(0)

  const scanWorkspace = useCallback(async (path: string | null) => {
    const generation = scanGeneration.current + 1
    scanGeneration.current = generation
    if (!path) {
      setDiscoveredRepos([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const decoded = await rpcScanForRepos(path)
      if (generation !== scanGeneration.current) {
        return
      }
      if (decoded._tag === 'Ok') {
        setDiscoveredRepos([...decoded.repos])
      } else {
        setDiscoveredRepos([])
        setError(decoded.message || 'Failed to scan for repositories')
      }
    } catch (err) {
      if (generation !== scanGeneration.current) {
        return
      }
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      if (generation === scanGeneration.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    window.electronAPI
      .getOnboardingComplete()
      .then(setOnboardingComplete)
      .catch((error: unknown) => {
        console.error('[onboarding] failed to load onboarding state', error)
        setOnboardingComplete(false)
      })
    Promise.all([window.electronAPI.getWorkspaces(), window.electronAPI.getActiveWorkspace()])
      .then(([list, active]) => {
        const safeList = list ?? []
        setWorkspaces(safeList)
        const resolved = active ?? safeList[0] ?? null
        setActiveWorkspace(resolved)
        if (resolved) {
          scanWorkspace(resolved)
        }
      })
      .catch((error: unknown) => {
        console.error('[onboarding] failed to load workspaces', error)
        setWorkspaces([])
        setActiveWorkspace(null)
      })
  }, [scanWorkspace])

  const completeOnboarding = async () => {
    setError(null)
    try {
      await window.electronAPI.setOnboardingComplete(true)
      setOnboardingComplete(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }

  const rescanWorkingDirectory = async () => {
    const active = activeWorkspace
    if (!active) {
      return
    }
    await scanWorkspace(active)
  }

  const addWorkspace = async (): Promise<string | null> => {
    setError(null)
    const path = await window.electronAPI.selectFolder()
    if (!path) {
      return null
    }
    setLoading(true)
    try {
      const list = await window.electronAPI.addWorkspace(path)
      setWorkspaces(list ?? [path])
      setActiveWorkspace(path)
      await scanWorkspace(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
    return path
  }

  const removeWorkspace = async (path: string) => {
    setError(null)
    try {
      const list = await window.electronAPI.removeWorkspace(path)
      const safeList = list ?? []
      setWorkspaces(safeList)
      if (activeWorkspace === path) {
        const next = safeList[0] ?? null
        setActiveWorkspace(next)
        await window.electronAPI.setActiveWorkspace(next)
        await scanWorkspace(next)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const switchWorkspace = async (path: string) => {
    if (path === activeWorkspace) {
      return
    }
    setError(null)
    setActiveWorkspace(path)
    await window.electronAPI.setActiveWorkspace(path)
    await scanWorkspace(path)
  }

  return {
    onboardingComplete,
    workingDirectory: activeWorkspace,
    workspaces,
    activeWorkspace,
    discoveredRepos,
    loading,
    error,
    completeOnboarding,
    rescanWorkingDirectory,
    addWorkspace,
    removeWorkspace,
    switchWorkspace
  }
}
