import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranches, GitLog, GitLogEntry, GitStatus, RepoData } from '../types'

type StatusResult = { success: boolean; status?: GitStatus; error?: string }
type OpResult = { success: boolean; error?: string }
type LogChunk = { repoPath: string; commits: GitLogEntry[]; done: boolean; error?: string }

export function useGit() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tracks which repo path is "live" for this hook instance. Used to discard
  // late-arriving log chunks if the user switched repos mid-stream.
  const activePathRef = useRef<string | null>(null)
  // Buffer for accumulating streamed commits; we hand React a fresh log array
  // only when we apply a chunk, but reads of the previous state come from
  // here to avoid re-cloning the whole list each chunk.
  const accumulatedRef = useRef<GitLogEntry[]>([])

  // Subscribe once per hook instance. Each tab's useGit gets its own listener
  // and filters by repoPath so chunks land in the right tab.
  useEffect(() => {
    const unsub = window.electronAPI.onLogChunk((chunk: LogChunk) => {
      if (chunk.repoPath !== activePathRef.current) return

      if (chunk.commits.length > 0) {
        // Mutate the ref's array and re-wrap so React sees a new object
        // reference. The cost is O(chunk.length) per chunk instead of
        // O(total) per chunk that `[...prev, ...new]` would incur.
        const buf = accumulatedRef.current
        for (const c of chunk.commits) buf.push(c)
        setLog({ all: buf.slice(), total: buf.length })
      }

      if (chunk.error) {
        setError(chunk.error)
      }
      if (chunk.done) {
        setLogLoading(false)
      }
    })
    return unsub
  }, [])

  const startLogStream = useCallback((path: string) => {
    accumulatedRef.current = []
    setLog({ all: [], total: 0 })
    setLogLoading(true)
    // Fire-and-forget — chunks arrive via the subscription above.
    window.electronAPI.startLogStream(path).catch((err: unknown) => {
      if (activePathRef.current !== path) return
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLogLoading(false)
    })
  }, [])

  const openRepo = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      activePathRef.current = path
      try {
        const result = (await window.electronAPI.openRepo(path)) as RepoData
        if (result.success) {
          setRepoPath(result.path)
          setStatus(result.status)
          setBranches(result.branches)
          setCurrentBranch(result.status.current)
          // Kick off the streamed log load. The renderer paints status +
          // branches immediately while commits arrive in batches.
          startLogStream(result.path)
        } else {
          setError(result.error || 'Failed to open repository')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    },
    [startLogStream]
  )

  const closeRepo = useCallback(async () => {
    if (!repoPath) return
    const wasPath = repoPath
    activePathRef.current = null
    accumulatedRef.current = []
    try {
      // Stop the underlying git process if it's still streaming.
      window.electronAPI.cancelLogStream().catch(() => {})
      await window.electronAPI.closeRepo(wasPath)
    } catch {
      // best-effort; nothing else to do if the main process failed to evict
    }
    setRepoPath(null)
    setStatus(null)
    setLog(null)
    setBranches(null)
    setCurrentBranch('')
    setError(null)
    setLogLoading(false)
  }, [repoPath])

  // Quiet status refresh — no `loading` toggle. Used after stage/unstage/commit
  // so a single staging click doesn't make every panel flash a "Loading" badge.
  const refreshStatus = useCallback(async () => {
    if (!repoPath) return
    try {
      const result = (await window.electronAPI.getStatus(repoPath)) as StatusResult
      if (result.success && result.status) {
        setStatus(result.status)
        setCurrentBranch(result.status.current)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }, [repoPath])

  const refreshLog = useCallback(async () => {
    if (!repoPath) return
    startLogStream(repoPath)
  }, [repoPath, startLogStream])

  // Full reload including branches. Reserved for an explicit "Refresh" action;
  // not used by individual file operations.
  const refreshRepo = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    try {
      const result = (await window.electronAPI.openRepo(repoPath)) as RepoData
      if (result.success) {
        setStatus(result.status)
        setBranches(result.branches)
        setCurrentBranch(result.status.current)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
    startLogStream(repoPath)
  }, [repoPath, startLogStream])

  const stageFile = useCallback(
    async (file: string) => {
      if (!repoPath) return
      const result = (await window.electronAPI.stageFile(repoPath, file)) as OpResult
      if (result.success) {
        await refreshStatus()
      }
    },
    [repoPath, refreshStatus]
  )

  const unstageFile = useCallback(
    async (file: string) => {
      if (!repoPath) return
      const result = (await window.electronAPI.unstageFile(repoPath, file)) as OpResult
      if (result.success) {
        await refreshStatus()
      }
    },
    [repoPath, refreshStatus]
  )

  const commit = useCallback(
    async (message: string) => {
      if (!repoPath) return false
      setLoading(true)
      try {
        const result = (await window.electronAPI.commit(repoPath, message)) as OpResult
        if (result.success) {
          await refreshStatus()
          await refreshLog()
          return true
        }
        return false
      } finally {
        setLoading(false)
      }
    },
    [repoPath, refreshStatus, refreshLog]
  )

  return {
    repoPath,
    status,
    log,
    branches,
    currentBranch,
    loading,
    logLoading,
    error,
    openRepo,
    closeRepo,
    refreshRepo,
    stageFile,
    unstageFile,
    commit
  }
}
