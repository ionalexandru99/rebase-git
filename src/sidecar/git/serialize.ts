import type { simpleGit } from 'simple-git'

interface RenamedFile {
  from: string
  to: string
}

interface StatusFileCode {
  path: string
  index: string
  working_dir: string
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
  files: StatusFileCode[]
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
    renamed: status.renamed.map((entry) => ({ from: entry.from, to: entry.to })),
    files: status.files.map((entry) => ({
      path: entry.path,
      index: entry.index,
      working_dir: entry.working_dir
    }))
  }
}

export function partitionBranchNames(names: readonly string[]): {
  local: string[]
  remotes: string[]
} {
  const local: string[] = []
  const remotes: string[] = []
  for (const name of names) {
    if (name.startsWith('remotes/')) {
      const stripped = name.slice('remotes/'.length)
      if (stripped.includes(' -> ')) {
        continue
      }
      remotes.push(stripped)
    } else {
      local.push(name)
    }
  }
  return { local, remotes }
}

export function serializeLocalBranches(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branch']>>,
  tracking?: Record<string, BranchTracking>
): Pick<SerializableBranches, 'current' | 'all' | 'tracking'> {
  const { local } = partitionBranchNames(branches.all)
  return {
    current: branches.current ?? '',
    all: local,
    tracking
  }
}

export function serializeRemoteBranchNames(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branch']>>
): string[] {
  const remotes: string[] = []
  for (const name of branches.all) {
    if (name.startsWith('remotes/')) {
      const stripped = name.slice('remotes/'.length)
      if (stripped.includes(' -> ')) {
        continue
      }
      remotes.push(stripped)
    } else {
      remotes.push(name)
    }
  }
  return remotes
}

export function serializeBranches(
  branches: Awaited<ReturnType<ReturnType<typeof simpleGit>['branch']>>,
  tags: Awaited<ReturnType<ReturnType<typeof simpleGit>['tags']>>,
  tracking?: Record<string, BranchTracking>
): SerializableBranches {
  const { local, remotes } = partitionBranchNames(branches.all)
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
    if (remote.refs?.fetch) {
      result[remote.name] = remote.refs.fetch
    }
  }
  return result
}
