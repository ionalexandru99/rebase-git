import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranches, GitLog, GitLogEntry, GitStatus, RepoOpenResult } from '../types'

type StatusResult = { success: boolean; status?: GitStatus; error?: string }
type BranchesResult = { success: boolean; branches?: GitBranches; error?: string }
type OpResult = { success: boolean; error?: string }
type LogChunk = { repoPath: string; commits: GitLogEntry[]; done: boolean; error?: string }

export function useGit() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [remotes, setRemotes] = useState<Record<string, string>>({})
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>(undefined)
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
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

  // Open in two phases:
  // 1. The `open-repo` IPC returns immediately with just the envelope (path,
  //    remotes, defaultBranch). The renderer can paint the workspace shell
  //    right away.
  // 2. Status, branches+tags, and the streamed log all fire in parallel.
  //    Each panel paints its own skeleton until its data lands; nothing
  //    waits on the slowest one.
  const openRepo = useCallback(
    async (path: string) => {
      setLoading(true)
      setStatusLoading(true)
      setBranchesLoading(true)
      setError(null)
      setStatus(null)
      setBranches(null)
      activePathRef.current = path
      try {
        const open = (await window.electronAPI.openRepo(path)) as RepoOpenResult
        if (!open.success) {
          console.error('[useGit] open-repo failed', { path, error: open.error })
          setError(open.error || 'Failed to open repository')
          setStatusLoading(false)
          setBranchesLoading(false)
          return
        }
        // The repo is now mounted on the main side; reveal it to the renderer
        // before we wait on the heavier follow-up calls.
        setRepoPath(open.path)
        setRemotes(open.remotes ?? {})
        setDefaultBranch(open.defaultBranch)

        // Start streaming the log right away — its skeleton path is already
        // wired through HistoryPanel.
        startLogStream(open.path)

        // Status and branches/tags fire concurrently; we don't await both
        // before resolving so that whichever returns first lights up its
        // panel without blocking the other.
        window.electronAPI
          .getStatus(open.path)
          .then((res) => {
            const r = res as StatusResult
            if (activePathRef.current !== open.path) return
            if (r.success && r.status) {
              setStatus(r.status)
              setCurrentBranch(r.status.current)
            } else if (r.error) {
              console.error('[useGit] get-status failed', { path: open.path, error: r.error })
              setError(r.error)
            }
          })
          .catch((err: unknown) => {
            if (activePathRef.current !== open.path) return
            console.error('[useGit] get-status threw', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
          })
          .finally(() => {
            if (activePathRef.current === open.path) setStatusLoading(false)
          })

        window.electronAPI
          .getBranches(open.path)
          .then((res) => {
            const r = res as BranchesResult
            if (activePathRef.current !== open.path) return
            if (r.success && r.branches) {
              setBranches(r.branches)
              // If status hasn't landed yet, seed the current branch from
              // the branch summary so the sidebar can highlight it.
              setCurrentBranch((prev) => prev || r.branches?.current || '')
            } else if (r.error) {
              console.error('[useGit] get-branches failed', { path: open.path, error: r.error })
              setError(r.error)
            }
          })
          .catch((err: unknown) => {
            if (activePathRef.current !== open.path) return
            console.error('[useGit] get-branches threw', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
          })
          .finally(() => {
            if (activePathRef.current === open.path) setBranchesLoading(false)
          })
      } catch (err) {
        console.error('[useGit] openRepo threw', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setStatusLoading(false)
        setBranchesLoading(false)
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
    setRemotes({})
    setDefaultBranch(undefined)
    setCurrentBranch('')
    setError(null)
    setLogLoading(false)
    setStatusLoading(false)
    setBranchesLoading(false)
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
    setStatusLoading(true)
    setBranchesLoading(true)
    try {
      const open = (await window.electronAPI.openRepo(repoPath)) as RepoOpenResult
      if (open.success) {
        setRemotes(open.remotes ?? {})
        setDefaultBranch(open.defaultBranch)
      }
      const [statusRes, branchesRes] = await Promise.all([
        window.electronAPI.getStatus(repoPath) as Promise<StatusResult>,
        window.electronAPI.getBranches(repoPath) as Promise<BranchesResult>
      ])
      if (statusRes.success && statusRes.status) {
        setStatus(statusRes.status)
        setCurrentBranch(statusRes.status.current)
      }
      if (branchesRes.success && branchesRes.branches) {
        setBranches(branchesRes.branches)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setStatusLoading(false)
      setBranchesLoading(false)
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
    remotes,
    defaultBranch,
    currentBranch,
    loading,
    statusLoading,
    branchesLoading,
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
