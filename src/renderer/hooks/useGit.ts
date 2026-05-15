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
      const result = await window.electronAPI.stageFile(file)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
      }
    },
    [refreshRepo]
  )

  const unstageFile = useCallback(
    async (file: string) => {
      const result = await window.electronAPI.unstageFile(file)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
      }
    },
    [refreshRepo]
  )

  const commit = useCallback(
    async (message: string) => {
      const result = await window.electronAPI.commit(message)
      if ((result as { success: boolean }).success) {
        await refreshRepo()
        return true
      }
      return false
    },
    [refreshRepo]
  )

  return {
    repoPath,
    status,
    log,
    currentBranch,
    loading,
    error,
    openRepo,
    refreshRepo,
    stageFile,
    unstageFile,
    commit
  }
}
