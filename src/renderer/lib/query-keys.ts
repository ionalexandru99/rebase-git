export function repoQueryKeys(repoPath: string) {
  const root = ['repo', repoPath] as const
  return {
    root,
    status: [...root, 'status'] as const,
    localBranches: [...root, 'local-branches'] as const,
    remoteRefs: [...root, 'remote-refs'] as const,
    log: [...root, 'log'] as const,
    diffRoot: [...root, 'diff'] as const,
    diff: (file: string, staged: boolean) => [...root, 'diff', file, staged] as const
  }
}
