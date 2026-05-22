import path from 'node:path'
import { type SimpleGit, simpleGit } from 'simple-git'

export function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath)
}

export function getOrCreateGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit {
  const key = normalizeRepoPath(repoPath)
  let g = map.get(key)
  if (!g) {
    g = simpleGit(key)
    map.set(key, g)
  }
  return g
}

export function lookupGit(map: Map<string, SimpleGit>, repoPath: string): SimpleGit | undefined {
  return map.get(normalizeRepoPath(repoPath))
}
