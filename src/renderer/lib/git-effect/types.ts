import type { GitBranches, GitLog, GitLogEntry, GitStatus } from '@/types'

export interface GitSetters {
  setRepoPath: (path: string | null) => void
  setRemotes: (remotes: Record<string, string>) => void
  setDefaultBranch: (branch: string | undefined) => void
  setCurrentBranch: (branch: string | ((prev: string) => string)) => void
  setStatus: (status: GitStatus | null) => void
  setBranches: (branches: GitBranches | null) => void
  setLog: (log: GitLog | null) => void
  appendLogChunk: (commits: GitLogEntry[]) => void
  resetLog: () => void
  setOpening: (value: boolean) => void
  setCommitting: (value: boolean) => void
  setStatusLoading: (value: boolean) => void
  setBranchesLoading: (value: boolean) => void
  setLogLoading: (value: boolean) => void
  setError: (message: string | null) => void
}
