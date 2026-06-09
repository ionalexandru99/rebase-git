export function repoQueryKeys(tabId: string, repoPath: string) {
  const root = ['tab', tabId, repoPath] as const
  return {
    root,
    status: [...root, 'status'] as const,
    branches: [...root, 'branches'] as const,
    localBranches: [...root, 'local-branches'] as const,
    remoteRefs: [...root, 'remote-refs'] as const,
    log: [...root, 'log'] as const,
    diffRoot: [...root, 'diff'] as const,
    diff: (file: string, staged: boolean) => [...root, 'diff', file, staged] as const
  }
}
