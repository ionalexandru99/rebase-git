import { parseOrThrow } from '@shared/codec'
import { ScanForReposResponseSchema } from '@shared/schemas/ipc'
import { type Accessor, createSignal, onMount } from 'solid-js'

export interface OnboardingStore {
  onboardingComplete: Accessor<boolean | null>
  workingDirectory: Accessor<string | null>
  workspaces: Accessor<string[]>
  activeWorkspace: Accessor<string | null>
  discoveredRepos: Accessor<string[]>
  loading: Accessor<boolean>
  error: Accessor<string | null>
  completeOnboarding: () => Promise<void>
  rescanWorkingDirectory: () => Promise<void>
  addWorkspace: () => Promise<string | null>
  removeWorkspace: (path: string) => Promise<void>
  switchWorkspace: (path: string) => Promise<void>
}

export function useOnboarding(): OnboardingStore {
  const [onboardingComplete, setOnboardingComplete] = createSignal<boolean | null>(null)
  const [workspaces, setWorkspaces] = createSignal<string[]>([])
  const [activeWorkspace, setActiveWorkspace] = createSignal<string | null>(null)
  const [discoveredRepos, setDiscoveredRepos] = createSignal<string[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const scanWorkspace = async (path: string | null) => {
    if (!path) {
      setDiscoveredRepos([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const decoded = parseOrThrow(
        ScanForReposResponseSchema,
        await window.electronAPI.scanForRepos(path)
      )
      if (decoded._tag === 'Ok') {
        setDiscoveredRepos([...decoded.repos])
      } else {
        setDiscoveredRepos([])
        setError(decoded.message || 'Failed to scan for repositories')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
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
  })

  const completeOnboarding = async () => {
    await window.electronAPI.setOnboardingComplete(true)
    setOnboardingComplete(true)
  }

  const rescanWorkingDirectory = async () => {
    const active = activeWorkspace()
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
      if (activeWorkspace() === path) {
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
    if (path === activeWorkspace()) {
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
