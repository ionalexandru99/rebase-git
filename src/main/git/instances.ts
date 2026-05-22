import fs from 'node:fs'
import path from 'node:path'
import { type SimpleGit, simpleGit } from 'simple-git'

export function normalizeRepoPath(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath)
  } catch {
    return path.resolve(repoPath)
  }
}

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
