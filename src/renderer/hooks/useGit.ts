import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranches, GitLog, GitLogEntry, GitStatus, RepoOpenResult } from '../types'

type StatusResult = { success: boolean; status?: GitStatus; error?: string }
type BranchesResult = { success: boolean; branches?: GitBranches; error?: string }
type OpResult = { success: boolean; error?: string }
type LogResult = { success: boolean; log?: GitLog; error?: string }
type FetchResult = { success: boolean; skipped?: boolean; error?: string }
type LogChunk = { repoPath: string; commits: GitLogEntry[]; done: boolean; error?: string }
type RepoChangedEvent = { repoPath: string; kind: 'refs' | 'workingTree' }

const AUTO_FETCH_INTERVAL_MS = 5 * 60 * 1000

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
  const [fetchResetKey, setFetchResetKey] = useState(0)

  const activePathRef = useRef<string | null>(null)
  const accumulatedRef = useRef<GitLogEntry[]>([])

  const silentRefreshRefs = useCallback((path: string) => {
    window.electronAPI
      .getBranches(path)
      .then((res) => {
        const r = res as BranchesResult
        if (activePathRef.current !== path) return
        if (r.success && r.branches) {
          setBranches(r.branches)
          if (r.branches.current) setCurrentBranch(r.branches.current)
        }
      })
      .catch((err: unknown) => {
        console.warn('[useGit] silent refresh branches failed', err)
      })

    window.electronAPI
      .getLog(path)
      .then((res) => {
        const r = res as LogResult
        if (activePathRef.current !== path) return
        if (r.success && r.log) {
          accumulatedRef.current = r.log.all.slice()
          setLog(r.log)
        }
      })
      .catch((err: unknown) => {
        console.warn('[useGit] silent refresh log failed', err)
      })
  }, [])

  const silentRefreshStatus = useCallback((path: string) => {
    window.electronAPI
      .getStatus(path)
      .then((res) => {
        const r = res as StatusResult
        if (activePathRef.current !== path) return
        if (r.success && r.status) {
          setStatus(r.status)
          setCurrentBranch(r.status.current)
        }
      })
      .catch((err: unknown) => {
        console.warn('[useGit] silent refresh status failed', err)
      })
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onLogChunk((chunk: LogChunk) => {
      if (chunk.repoPath !== activePathRef.current) return

      if (chunk.commits.length > 0) {
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

  const runFetchAndRefresh = useCallback(
    async (path: string) => {
      let result: FetchResult
      try {
        result = (await window.electronAPI.fetchRepo(path)) as FetchResult
      } catch (err) {
        console.warn('[useGit] fetch failed', err)
        return
      }
      if (activePathRef.current !== path) return
      if (!result.success || result.skipped) {
        if (!result.success) console.warn('[useGit] fetch failed', result.error)
        return
      }
      silentRefreshRefs(path)
    },
    [silentRefreshRefs]
  )

  const fetchNow = useCallback(async () => {
    if (!repoPath) return
    setFetchResetKey((n) => n + 1)
    await runFetchAndRefresh(repoPath)
  }, [repoPath, runFetchAndRefresh])

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetchResetKey is intentionally a trigger dep — bumping it restarts the auto-fetch interval after a manual fetch
  useEffect(() => {
    if (!repoPath) return
    const path = repoPath
    const handle = window.setInterval(() => {
      if (activePathRef.current !== path) return
      runFetchAndRefresh(path)
    }, AUTO_FETCH_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [repoPath, runFetchAndRefresh, fetchResetKey])

  useEffect(() => {
    const unsub = window.electronAPI.onRepoChanged((evt: RepoChangedEvent) => {
      if (evt.repoPath !== activePathRef.current) return
      if (evt.kind === 'refs') {
        silentRefreshRefs(evt.repoPath)
      } else {
        silentRefreshStatus(evt.repoPath)
      }
    })
    return unsub
  }, [silentRefreshRefs, silentRefreshStatus])

  // Releases the main-side repo (simple-git instance, chokidar watcher,
  // any active fetch) when this hook unmounts — i.e. when its tab closes.
  // Reads activePathRef at unmount time so the latest path is always cleaned up.
  useEffect(() => {
    return () => {
      const wasPath = activePathRef.current
      if (!wasPath) return
      activePathRef.current = null
      Promise.resolve(window.electronAPI.cancelLogStream()).catch(() => {})
      Promise.resolve(window.electronAPI.closeRepo(wasPath)).catch(() => {})
    }
  }, [])

  const startLogStream = useCallback((path: string) => {
    accumulatedRef.current = []
    setLog({ all: [], total: 0 })
    setLogLoading(true)
    window.electronAPI.startLogStream(path).catch((err: unknown) => {
      if (activePathRef.current !== path) return
      setError(err instanceof Error ? err.message : 'Unknown error')
      setLogLoading(false)
    })
  }, [])

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
        setRepoPath(open.path)
        setRemotes(open.remotes ?? {})
        setDefaultBranch(open.defaultBranch)

        startLogStream(open.path)

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
      window.electronAPI.cancelLogStream().catch(() => {})
      await window.electronAPI.closeRepo(wasPath)
    } catch {}
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
    stageFile,
    unstageFile,
    commit,
    fetchNow
  }
}
