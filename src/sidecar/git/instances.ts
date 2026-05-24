import { normalizeRepoPath } from '@shared/repo-path'
import { type SimpleGit, simpleGit } from 'simple-git'

export { normalizeRepoPath }

export function getOrCreateGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit {
  const key = normalizeRepoPath(repoPath)
  let git = map.get(key)
  if (!git) {
    git = simpleGit(key)
    map.set(key, git)
  }
  return git
}

export function lookupGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit | undefined {
  return map.get(normalizeRepoPath(repoPath))
}
