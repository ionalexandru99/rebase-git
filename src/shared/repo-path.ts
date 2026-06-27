import fs from 'node:fs'
import path from 'node:path'

export function normalizeRepoPath(repoPath: string): string {
  try {
    return fs.realpathSync.native(repoPath)
  } catch {
    return path.resolve(repoPath)
  }
}

export function tabResourceKey(webContentsId: number, repoPath: string): string {
  return `${webContentsId}:${normalizeRepoPath(repoPath)}`
}
