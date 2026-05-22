import { decodeOrThrow } from '@shared/codec'
import { BranchesResponse, OpenRepoResponse, StatusResponse } from '@shared/schemas/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '../types'

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
        const decoded = decodeOrThrow(BranchesResponse, res)
        if (activePathRef.current !== path) return
        if (decoded._tag === 'Ok') {
          setBranches(decoded.branches)
          if (decoded.branches.current) setCurrentBranch(decoded.branches.current)
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
        const decoded = decodeOrThrow(StatusResponse, res)
        if (activePathRef.current !== path) return
        if (decoded._tag === 'Ok') {
          setStatus(decoded.status)
          setCurrentBranch(decoded.status.current)
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
      // Provisional — main returns the canonical form which overwrites this on success.
      // Setting it now means stale chunks from a previous repo are ignored while the new
      // open-repo round-trip is in flight.
      activePathRef.current = path
      try {
        const decodedOpen = decodeOrThrow(OpenRepoResponse, await window.electronAPI.openRepo(path))
        if (decodedOpen._tag !== 'Ok') {
          const errorMessage =
            decodedOpen._tag === 'NotARepo' ? 'Not a git repository' : decodedOpen.message
          console.error('[useGit] open-repo failed', { path, error: errorMessage })
          setError(errorMessage)
          setStatusLoading(false)
          setBranchesLoading(false)
          return
        }
        const opened = decodedOpen.result
        // Adopt the canonical path so chunk/refresh path comparisons match what main sends.
        activePathRef.current = opened.path
        setRepoPath(opened.path)
        setRemotes(opened.remotes)
        setDefaultBranch(opened.defaultBranch)

        startLogStream(opened.path)

        window.electronAPI
          .getStatus(opened.path)
          .then((res) => {
            const decoded = decodeOrThrow(StatusResponse, res)
            if (activePathRef.current !== opened.path) return
            if (decoded._tag === 'Ok') {
              setStatus(decoded.status)
              setCurrentBranch(decoded.status.current)
            } else if (decoded._tag === 'GitError') {
              console.error('[useGit] get-status failed', {
                path: opened.path,
                error: decoded.message
              })
              setError(decoded.message)
            }
          })
          .catch((err: unknown) => {
            if (activePathRef.current !== opened.path) return
            console.error('[useGit] get-status threw', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
          })
          .finally(() => {
            if (activePathRef.current === opened.path) setStatusLoading(false)
          })

        window.electronAPI
          .getBranches(opened.path)
          .then((res) => {
            const decoded = decodeOrThrow(BranchesResponse, res)
            if (activePathRef.current !== opened.path) return
            if (decoded._tag === 'Ok') {
              setBranches(decoded.branches)
              setCurrentBranch((prev) => prev || decoded.branches.current || '')
            } else if (decoded._tag === 'GitError') {
              console.error('[useGit] get-branches failed', {
                path: opened.path,
                error: decoded.message
              })
              setError(decoded.message)
            }
          })
          .catch((err: unknown) => {
            if (activePathRef.current !== opened.path) return
            console.error('[useGit] get-branches threw', err)
            setError(err instanceof Error ? err.message : 'Unknown error')
          })
          .finally(() => {
            if (activePathRef.current === opened.path) setBranchesLoading(false)
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
      const decoded = decodeOrThrow(StatusResponse, await window.electronAPI.getStatus(repoPath))
      if (decoded._tag === 'Ok') {
        setStatus(decoded.status)
        setCurrentBranch(decoded.status.current)
      } else if (decoded._tag === 'GitError') {
        setError(decoded.message)
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
