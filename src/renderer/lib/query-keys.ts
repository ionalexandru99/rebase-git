export function repoQueryKeys(tabId: string, repoPath: string) {
  const root = ['tab', tabId, repoPath] as const
  return {
    root,
    status: [...root, 'status'] as const,
    branches: [...root, 'branches'] as const,
    log: [...root, 'log'] as const
  }
}
