import type { RepoRef } from '@common/features/repository-identity'
import { toRepoRef } from './repository-identity'

type RepoQueryRoot = readonly ['repo', string, string] | readonly ['repo', 'idle', string]

interface IdleRepoQueryKeyOptions {
  idle: string
}

const buildRepoQueryKeys = (root: RepoQueryRoot) => ({
  root,
  status: [...root, 'status'] as const,
  localBranches: [...root, 'local-branches'] as const,
  remoteRefs: [...root, 'remote-refs'] as const,
  log: [...root, 'log'] as const,
  stash: [...root, 'stash'] as const,
  headCommit: [...root, 'head-commit'] as const,
  diffRoot: [...root, 'diff'] as const,
  diff: (file: string, staged: boolean, range?: string) =>
    range === undefined
      ? ([...root, 'diff', file, staged] as const)
      : ([...root, 'diff', file, staged, range] as const),
  commitDetail: (sha: string) => [...root, 'commit-detail', sha] as const,
  commitDiff: (sha: string, file: string) => [...root, 'commit-diff', sha, file] as const
})

export type RepoQueryKeys = ReturnType<typeof buildRepoQueryKeys>

export function repoQueryKeys(repository: RepoRef | string): RepoQueryKeys
export function repoQueryKeys(
  repository: RepoRef | string | null | undefined,
  options: IdleRepoQueryKeyOptions
): RepoQueryKeys
export function repoQueryKeys(
  repository: RepoRef | string | null | undefined,
  options?: IdleRepoQueryKeyOptions
): RepoQueryKeys {
  if (repository !== null && repository !== undefined) {
    const repoRef = toRepoRef(repository)
    return buildRepoQueryKeys(['repo', repoRef.environmentId, repoRef.path] as const)
  }
  if (!options) {
    throw new Error('repoQueryKeys requires an idle scope when repository is empty')
  }
  return buildRepoQueryKeys(['repo', 'idle', options.idle] as const)
}
