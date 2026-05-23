import { useMemo, useRef, useState } from 'react'
import type { GitSetters } from '@/lib/git-effect/types'
import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

export interface GitState {
  repoPath: string | null
  status: GitStatus | null
  log: GitLog | null
  branches: GitBranches | null
  remotes: Record<string, string>
  defaultBranch: string | undefined
  currentBranch: string
  opening: boolean
  committing: boolean
  statusLoading: boolean
  branchesLoading: boolean
  logLoading: boolean
  error: string | null
}

export function useGitState() {
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [log, setLog] = useState<GitLog | null>(null)
  const [branches, setBranches] = useState<GitBranches | null>(null)
  const [remotes, setRemotes] = useState<Record<string, string>>({})
  const [defaultBranch, setDefaultBranch] = useState<string | undefined>(undefined)
  const [currentBranch, setCurrentBranch] = useState<string>('')
  const [opening, setOpening] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accumulatedRef = useRef<GitLogEntry[]>([])
  const repoPathRef = useRef<string | null>(null)
  repoPathRef.current = repoPath

  const setters = useMemo<GitSetters>(
    () => ({
      setRepoPath,
      setRemotes,
      setDefaultBranch,
      setCurrentBranch,
      setStatus,
      setBranches,
      setLog,
      appendLogChunk: (commits) => {
        const buffer = accumulatedRef.current
        for (const commit of commits) buffer.push(commit)
        setLog({ all: buffer.slice(), total: buffer.length })
      },
      resetLog: () => {
        accumulatedRef.current = []
      },
      setOpening,
      setCommitting,
      setStatusLoading,
      setBranchesLoading,
      setLogLoading,
      setError
    }),
    []
  )

  const state: GitState = {
    repoPath,
    status,
    log,
    branches,
    remotes,
    defaultBranch,
    currentBranch,
    opening,
    committing,
    statusLoading,
    branchesLoading,
    logLoading,
    error
  }

  const reset = () => {
    accumulatedRef.current = []
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
    setOpening(false)
    setCommitting(false)
  }

  return { state, setters, accumulatedRef, repoPathRef, reset }
}
