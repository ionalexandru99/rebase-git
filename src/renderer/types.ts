export interface GitStatus {
  modified: string[]
  staged: string[]
  not_added: string[]
  current: string
}

export interface GitLogEntry {
  hash: string
  message: string
  author_name: string
  date: string
  parents: string[]
  refs: string
}

export interface GitLog {
  all: GitLogEntry[]
  total: number
}

export interface GitBranches {
  current: string
  all: string[]
  remotes: string[]
  tags: string[]
}

// Returned by the `open-repo` IPC. Only the cheap envelope — status and
// branches arrive separately through `get-status` and `get-branches` so each
// panel can paint independently.
export interface RepoOpenResult {
  success: boolean
  error?: string
  remotes: Record<string, string>
  defaultBranch?: string
  path: string
}
