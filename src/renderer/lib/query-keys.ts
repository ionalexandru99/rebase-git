type RepoQueryRoot = readonly ['repo', string] | readonly ['repo', 'idle', string]

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
  diffRoot: [...root, 'diff'] as const,
  diff: (file: string, staged: boolean) => [...root, 'diff', file, staged] as const,
  hunkHighlight: (file: string, hunkKey: string) =>
    [...root, 'hunk-highlight', file, hunkKey] as const
})

export type RepoQueryKeys = ReturnType<typeof buildRepoQueryKeys>

export function repoQueryKeys(repoPath: string): RepoQueryKeys
export function repoQueryKeys(
  repoPath: string | null | undefined,
  options: IdleRepoQueryKeyOptions
): RepoQueryKeys
export function repoQueryKeys(
  repoPath: string | null | undefined,
  options?: IdleRepoQueryKeyOptions
): RepoQueryKeys {
  if (repoPath !== null && repoPath !== undefined) {
    return buildRepoQueryKeys(['repo', repoPath] as const)
  }
  if (!options) {
    throw new Error('repoQueryKeys requires an idle scope when repoPath is empty')
  }
  return buildRepoQueryKeys(['repo', 'idle', options.idle] as const)
}
