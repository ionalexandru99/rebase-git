import fs from 'node:fs'
import path from 'node:path'
import { type SimpleGit, simpleGit } from 'simple-git'

// Canonicalizes a repo path so that two spellings of the same physical directory
// (trailing slash, `..`/`.` segments, symlinks, case-different drives on Windows)
// share one SimpleGit instance and one watcher. realpathSync requires the path
// to exist; if it doesn't (e.g. the dir was deleted while a close-repo races a
// reopen), we fall back to path.resolve so the call doesn't throw.
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
