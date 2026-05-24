import type { simpleGit } from 'simple-git'

interface RenamedFile {
  from: string
  to: string
}

export interface SerializableStatus {
  current: string
  modified: string[]
  staged: string[]
  not_added: string[]
  conflicted: string[]
  deleted: string[]
  created: string[]
  renamed: RenamedFile[]
}

export interface SerializableLogEntry {
  hash: string
  message: string
  author_name: string
  date: string
  parents: string[]
  refs: string
}

export interface SerializableLog {
  all: SerializableLogEntry[]
  total: number
}

export interface BranchTracking {
  ahead: number
  behind: number
}

export interface SerializableBranches {
  current: string
  all: string[]
  remotes: string[]
  tags: string[]
  tracking?: Record<string, BranchTracking>
}

export const GRAPH_LOG_FORMAT = {
  hash: '%H',
  date: '%aI',
  message: '%s',
  refs: '%D',
  body: '',
  author_name: '%aN',
  author_email: '%aE',
  parents: '%P'
} as const

export const GRAPH_LOG_FLAGS = {
  '--branches': null,
  '--remotes': null,
  '--date-order': null
} as const

export function serializeStatus(
  status: Awaited<ReturnType<ReturnType<typeof simpleGit>['status']>>
): SerializableStatus {
  return {
    current: status.current ?? '',
    modified: [...status.modified],
    staged: [...status.staged],
    not_added: [...status.not_added],
    conflicted: [...status.conflicted],
    deleted: [...status.deleted],
    created: [...status.created],
    renamed: status.renamed.map((entry) => ({ from: entry.from, to: entry.to }))
  }
}

export function serializeLog(
  log: Awaited<ReturnType<ReturnType<typeof simpleGit>['log']>>
): SerializableLog {
  return {
    total: log.total,
    all: log.all.map((entry) => {
      const raw = entry as typeof entry & { parents?: string; refs?: string }
      const parents = raw.parents ? raw.parents.split(' ').filter(Boolean) : []
      return {
        hash: entry.hash,
        message: entry.message,
        author_name: entry.author_name,
        date: entry.date,
        parents,
        refs: raw.refs ?? ''
      }
    })
  }
}

export function serializeBranches(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branch']>>,
  tags: Awaited<ReturnType<ReturnType<typeof simpleGit>['tags']>>,
  tracking?: Record<string, BranchTracking>
): SerializableBranches {
  const local: string[] = []
  const remotes: string[] = []
  for (const name of branches.all) {
    if (name.startsWith('remotes/')) {
      const stripped = name.slice('remotes/'.length)
      if (stripped.includes(' -> ')) continue
      remotes.push(stripped)
    } else {
      local.push(name)
    }
  }
  return {
    current: branches.current ?? '',
    all: local,
    remotes,
    tags: [...tags.all],
    tracking
  }
}

export function serializeRemotes(
  remotes: Array<{ name: string; refs: { fetch: string; push: string } }>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const remote of remotes) {
    if (remote.refs?.fetch) result[remote.name] = remote.refs.fetch
  }
  return result
}
