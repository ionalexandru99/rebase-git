export function repoDisplayName(repoPath: string | undefined): string {
  if (!repoPath) return 'Repository'
  const trimmed = repoPath.replace(/[/\\]+$/, '')
  const segment = trimmed.split(/[/\\]/).filter(Boolean).at(-1)
  return segment ?? 'Repository'
}
