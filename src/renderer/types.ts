export interface RenamedFile {
  from: string
  to: string
}

export interface GitStatus {
  current: string
  modified: string[]
  staged: string[]
  not_added: string[]
  conflicted: string[]
  deleted: string[]
  created: string[]
  renamed: RenamedFile[]
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

export interface RepoOpenResult {
  success: boolean
  error?: string
  remotes: Record<string, string>
  defaultBranch?: string
  path: string
}
