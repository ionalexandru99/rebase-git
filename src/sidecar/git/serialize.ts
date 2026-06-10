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
