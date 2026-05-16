import { useCallback, useState } from 'react'
import type { GitLog, GitStatus, RepoData } from '../types'

export function useGit() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openRepo = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = (await window.electronAPI.openRepo(path)) as RepoData
      if (result.success) {
        setRepoPath(result.path)
        setStatus(result.status)
        setLog(result.log)
        setCurrentBranch(result.status.current)
      } else {
        setError(result.error || 'Failed to open repository')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  const closeRepo = useCallback(async () => {
    if (!repoPath) return
    try {
      await window.electronAPI.closeRepo(repoPath)
    } catch {
      // best-effort; nothing else to do if the main process failed to evict
    }
    setRepoPath(null)
    setStatus(null)
    setLog(null)
    setCurrentBranch('')
    setError(null)
  }, [repoPath])

  const refreshRepo = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const result = (await window.electronAPI.openRepo(repoPath)) as RepoData
      if (result.success) {
        setStatus(result.status)
        setLog(result.log)
        setCurrentBranch(result.status.current)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  const stageFile = useCallback(
    async (file: string) => {
      if (!repoPath) return
      const result = await window.electronAPI.stageFile(repoPath, file)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
      }
    },
    [repoPath, refreshRepo]
  )

  const unstageFile = useCallback(
    async (file: string) => {
      if (!repoPath) return
      const result = await window.electronAPI.unstageFile(repoPath, file)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
      }
    },
    [repoPath, refreshRepo]
  )

  const commit = useCallback(
    async (message: string) => {
      if (!repoPath) return false
      const result = await window.electronAPI.commit(repoPath, message)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
        return true
      }
      return false
    },
    [repoPath, refreshRepo]
  )

  return {
    repoPath,
    status,
    log,
    currentBranch,
    loading,
    error,
    openRepo,
    closeRepo,
    refreshRepo,
    stageFile,
    unstageFile,
    commit
  }
}
